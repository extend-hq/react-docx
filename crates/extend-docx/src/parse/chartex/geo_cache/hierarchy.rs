use super::{
    children, cx_child, entity_id, entity_type, results, us_name, GeoRegion, Names, MAX_VERTICES,
};
use roxmltree::Node;
use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub(super) struct Hierarchy<'a> {
    pub(super) parents: HashMap<&'a str, Vec<&'a str>>,
    children: HashMap<&'a str, Vec<&'a str>>,
    pub(super) details: HashMap<&'a str, (&'a str, &'a str)>,
    pub(super) boxes: HashMap<&'a str, [f64; 4]>,
}

#[derive(Clone, Copy, Default)]
pub(super) struct Focus {
    pub(super) bounds: Option<[f64; 4]>,
    pub(super) us: bool,
}

impl<'a> Hierarchy<'a> {
    pub(super) fn read(clears: &[Node<'a, 'a>]) -> Self {
        let mut h = Self::default();
        for item in results(
            clears,
            "geoChildEntitiesQueryResults",
            "geoChildEntitiesQueryResult",
        ) {
            let parent = cx_child(item, "geoChildEntitiesQuery").and_then(entity_id);
            for node in children(cx_child(item, "geoChildEntities"), "geoHierarchyEntity") {
                if let Some(id) = entity_id(node) {
                    h.details.insert(
                        id,
                        (
                            node.attribute("entityName").unwrap_or_default(),
                            entity_type(node).unwrap_or_default(),
                        ),
                    );
                    if let Some(parent) = parent {
                        h.link(parent, id);
                    }
                }
            }
        }
        for item in results(
            clears,
            "geoParentEntitiesQueryResults",
            "geoParentEntitiesQueryResult",
        ) {
            let Some(id) = cx_child(item, "geoParentEntitiesQuery").and_then(entity_id) else {
                continue;
            };
            if let Some(node) = cx_child(item, "geoEntity") {
                h.details.insert(
                    id,
                    (
                        node.attribute("entityName").unwrap_or_default(),
                        entity_type(node).unwrap_or_default(),
                    ),
                );
            }
            if let Some(parent) = cx_child(item, "geoParentEntity").and_then(entity_id) {
                h.link(parent, id);
            }
        }
        h
    }

    fn link(&mut self, parent: &'a str, child: &'a str) {
        self.parents.entry(child).or_default().push(parent);
        self.children.entry(parent).or_default().push(child);
    }

    fn focus(&self, id: &str, ids: &HashMap<&str, usize>, names: &[Names], bing: bool) -> Focus {
        let us = self.details.get(id).is_some_and(|&(name, kind)| {
            kind.eq_ignore_ascii_case("countryRegion")
                && ((bing && id == "244")
                    || us_name(name)
                    || ids
                        .get(id)
                        .is_some_and(|&i| names[i].country_is_us == Some(true)))
        });
        Focus {
            bounds: self.boxes.get(id).copied(),
            us,
        }
    }

    /// A single entity fills its own view; multiple entities expand to their closest cached common geography.
    pub(super) fn natural_view(
        &self,
        ids: &HashMap<&str, usize>,
        names: &[Names],
        regions: &mut [GeoRegion],
        bing: bool,
    ) -> Option<(bool, Focus)> {
        let selected: Vec<_> = regions
            .iter()
            .enumerate()
            .filter_map(|(i, r)| r.point_index.map(|_| i))
            .collect();
        let &first = selected.first()?;
        for r in &mut *regions {
            r.in_natural_view = r.point_index.is_some();
        }
        if selected.len() == 1 {
            let region = &regions[first];
            let us = region.entity_type.eq_ignore_ascii_case("countryRegion")
                && (names[first].country_is_us == Some(true)
                    || us_name(&region.name)
                    || (bing && ids.get("244") == Some(&first)));
            return Some((
                !region.entity_type.eq_ignore_ascii_case("planet"),
                Focus {
                    bounds: region.bounds,
                    us,
                },
            ));
        }
        let kind = |id: &str| {
            self.details
                .get(id)
                .map(|e| e.1)
                .or_else(|| ids.get(id).map(|&i| regions[i].entity_type.as_str()))
                .unwrap_or_default()
        };
        let rank = |kind: &str| match kind.to_ascii_lowercase().as_str() {
            "address" | "postalcode" | "locality" => Some(0),
            "admindistrict3" => Some(1),
            "admindistrict2" => Some(2),
            "admindistrict" | "admindistrict1" => Some(3),
            "countryregion" => Some(4),
            "region" | "countryregions" => Some(5),
            "continent" | "ocean" => Some(6),
            _ => None,
        };
        let shared_country: Vec<_> = names[first]
            .country
            .iter()
            .filter(|c| selected.iter().all(|&i| names[i].country.contains(*c)))
            .collect();
        let mut region_ids = vec![Vec::new(); regions.len()];
        for (&id, &i) in ids {
            region_ids[i].push(id);
        }
        let mut common: Option<HashSet<&str>> = None;
        let mut all_have_continent = true;
        let mut budget = MAX_VERTICES;
        for i in selected {
            let mut ancestors = HashSet::new();
            let mut seen = HashSet::new();
            let mut has_continent = false;
            let mut pending = std::mem::take(&mut region_ids[i]);
            while let Some(id) = pending.pop() {
                if !seen.insert(id) {
                    continue;
                }
                let typ = kind(id);
                if let Some(level) = rank(typ) {
                    ancestors.insert(id);
                    has_continent |= level >= 5;
                } else if typ.eq_ignore_ascii_case("planet") {
                    has_continent = true;
                }
                if let Some(parents) = self.parents.get(id) {
                    budget = budget.checked_sub(parents.len())?;
                    pending.extend_from_slice(parents);
                }
            }
            all_have_continent &= has_continent;
            if let Some(prev) = &mut common {
                prev.retain(|id| ancestors.contains(id));
            } else {
                common = Some(ancestors);
            }
        }
        let closest = common?
            .into_iter()
            .filter_map(|id| Some((rank(kind(id))?, id)))
            .min();
        if let Some((_, parent)) = closest.filter(|(r, _)| *r <= 4 || shared_country.is_empty()) {
            for id in reachable(vec![parent], &self.children) {
                if let Some(&i) = ids.get(id).filter(|_| id != parent) {
                    regions[i].in_natural_view = true;
                }
            }
            Some((true, self.focus(parent, ids, names, bing)))
        } else if !shared_country.is_empty() {
            let mut focus = Focus::default();
            for (r, n) in regions.iter_mut().zip(names) {
                if shared_country.iter().any(|k| n.country.contains(*k)) {
                    if r.entity_type.eq_ignore_ascii_case("countryRegion") {
                        focus.bounds = focus.bounds.or(r.bounds);
                        focus.us |= us_name(&r.name) || n.country_is_us == Some(true);
                    } else {
                        r.in_natural_view = true;
                    }
                }
            }
            Some((true, focus))
        } else if all_have_continent {
            for r in regions {
                r.in_natural_view = true;
            }
            Some((false, Focus::default()))
        } else {
            None
        }
    }

    pub(super) fn select_view(
        &self,
        view: Option<&str>,
        ids: &HashMap<&str, usize>,
        names: &[Names],
        regions: &mut [GeoRegion],
        bing: bool,
    ) -> Option<Focus> {
        if view.is_none() {
            for r in regions {
                r.in_view = r.in_natural_view;
            }
            return None;
        }
        let Some(
            view @ ("dataOnly" | "postalCode" | "county" | "state" | "countryRegion"
            | "countryRegionList"),
        ) = view
        else {
            return None;
        };
        for region in &mut *regions {
            region.in_view = region.point_index.is_some();
        }
        if view == "dataOnly" {
            return None;
        }
        let target_level = |kind: &str| match kind.to_ascii_lowercase().as_str() {
            "postalcode" => "postalCode",
            "admindistrict2" => "county",
            "admindistrict" | "admindistrict1" => "state",
            "countryregion" => "countryRegion",
            "continent" | "countryregions" => "countryRegionList",
            _ => "",
        };
        let seeds = ids
            .iter()
            .filter(|(_, &i)| regions[i].in_view)
            .map(|(&id, _)| id)
            .collect();
        let mut targets: Vec<_> = reachable(seeds, &self.parents)
            .into_iter()
            .filter(|id| {
                self.details
                    .get(id)
                    .is_some_and(|&(_, kind)| target_level(kind) == view)
                    || ids
                        .get(id)
                        .is_some_and(|&i| target_level(&regions[i].entity_type) == view)
            })
            .collect();
        let mut scope_by_name = HashMap::new();
        for (&id, &i) in ids {
            if target_level(&regions[i].entity_type) == view {
                for name in &names[i].leaf {
                    scope_by_name
                        .entry(name)
                        .and_modify(|v| {
                            if *v != Some(id) {
                                *v = None;
                            }
                        })
                        .or_insert(Some(id));
                }
            }
        }
        for (_, n) in names
            .iter()
            .enumerate()
            .filter(|(i, _)| regions[*i].in_view)
        {
            targets.extend(
                n.scope
                    .iter()
                    .filter_map(|s| scope_by_name.get(s).copied().flatten()),
            );
        }
        targets.sort_unstable();
        targets.dedup();
        let focus = match targets.as_slice() {
            [id] => Some(self.focus(id, ids, names, bing)),
            _ => None,
        };
        // A cached parent supplies projection bounds; its constituent boundaries paint the map.
        let parents: HashSet<_> = targets
            .iter()
            .copied()
            .filter(|id| self.children.contains_key(id))
            .collect();
        for id in reachable(targets, &self.children) {
            if let Some(&i) = ids.get(id).filter(|_| !parents.contains(id)) {
                regions[i].in_view = true;
            }
        }
        focus
    }
}

fn reachable<'a>(
    mut pending: Vec<&'a str>,
    edges: &HashMap<&'a str, Vec<&'a str>>,
) -> HashSet<&'a str> {
    let mut seen = HashSet::new();
    while let Some(id) = pending.pop() {
        if seen.insert(id) {
            if let Some(neighbors) = edges.get(id) {
                pending.extend_from_slice(neighbors);
            }
        }
    }
    seen
}
