use crate::chart::{cx_child, ChartPoint, CHARTEX_NS};
use base64::{engine::general_purpose::STANDARD, Engine};
use roxmltree::{Document, Node, ParsingOptions};
use std::borrow::Cow;
use std::collections::{BTreeSet, HashMap, HashSet};

mod hierarchy;
use hierarchy::Hierarchy;

const MAX_BYTES: usize = 32 << 20;
const MAX_NODES: u32 = 150_000;
const MAX_VERTICES: usize = 3_000_000;
const MAX_LABEL_BYTES: usize = 1024;

pub(super) struct GeoCache {
    pub regions: Vec<GeoRegion>,
    pub credits: Vec<String>,
    pub us_only: bool,
    pub regional: Option<bool>,
    pub projection_bounds: Option<[f64; 4]>,
}

pub(super) struct GeoRegion {
    pub name: String,
    pub entity_type: String,
    pub point_index: Option<u32>,
    pub in_view: bool,
    pub in_natural_view: bool,
    pub center: Option<(f64, f64)>,
    /// West, south, east, north. A west bound greater than east crosses the dateline.
    pub bounds: Option<[f64; 4]>,
    /// Each polygon keeps its exterior and interior rings together, in longitude/latitude order.
    pub polygons: Vec<Vec<Vec<(f64, f64)>>>,
}

pub(super) fn read(cache: Node, dataset: Option<Node>, points: &[ChartPoint]) -> Option<GeoCache> {
    if !cache.has_tag_name((CHARTEX_NS, "geoCache"))
        || points.len() > MAX_NODES as usize
        || dataset.is_some_and(|d| d.range().len() > MAX_BYTES)
    {
        return None;
    }
    let bing = cache.attribute("provider").is_some_and(|s| {
        s.trim_matches(['{', '}'])
            .eq_ignore_ascii_case("E9337A44-BEBE-4D9F-B70C-5C5E7DAFC167")
    });
    let view = cache
        .parent_element()
        .and_then(|g| g.attribute("viewedRegionType"));
    if cache.range().len() > MAX_BYTES
        || cache.children().filter(Node::is_element).nth(64).is_some()
    {
        return None;
    }
    let clears: Vec<_> = children(Some(cache), "clear").collect();
    let mut nodes_left = MAX_NODES;
    let mut bytes_left = MAX_BYTES;
    for clear in &clears {
        bytes_left = bytes_left.checked_sub(clear.range().len())?;
        nodes_left = nodes_left.checked_sub(u32::try_from(clear.descendants().count()).ok()?)?;
    }
    let has_plain_geometry = clears
        .iter()
        .any(|n| cx_child(*n, "geoDataEntityQueryResults").is_some());
    if has_plain_geometry {
        if let Some(map) = read_clear(&clears, dataset, points, view, bing) {
            return Some(map);
        }
    }
    let inflated = children(Some(cache), "binary")
        .map(|node| {
            let data = inflate(node.text()?, bytes_left)?;
            bytes_left = bytes_left.checked_sub(data.len())?;
            Some(data)
        })
        .collect::<Option<Vec<_>>>()?;
    if inflated.is_empty() {
        return None;
    }
    let docs = inflated
        .iter()
        .map(|bytes| {
            let doc = Document::parse_with_options(
                std::str::from_utf8(bytes).ok()?,
                ParsingOptions {
                    nodes_limit: nodes_left,
                    ..Default::default()
                },
            )
            .ok()?;
            nodes_left = nodes_left.checked_sub(u32::try_from(doc.descendants().count()).ok()?)?;
            doc.root_element()
                .has_tag_name((CHARTEX_NS, "clear"))
                .then_some(doc)
        })
        .collect::<Option<Vec<_>>>()?;
    let mut all = if has_plain_geometry {
        Vec::new()
    } else {
        clears
    };
    all.extend(docs.iter().map(Document::root_element));
    read_clear(&all, dataset, points, view, bing)
}

fn inflate(text: &str, limit: usize) -> Option<Vec<u8>> {
    if limit == 0 || text.is_empty() {
        return None;
    }
    let base64 = if text.bytes().any(|b| b.is_ascii_whitespace()) {
        Cow::Owned(text.bytes().filter(|b| !b.is_ascii_whitespace()).collect())
    } else {
        Cow::Borrowed(text.as_bytes())
    };
    let mut compressed = STANDARD.decode(base64.as_ref()).ok()?;
    // A sync-flushed raw DEFLATE stream can end at an empty stored block without BFINAL.
    if compressed.ends_with(&[0, 0, 255, 255]) {
        compressed.extend_from_slice(&[1, 0, 0, 255, 255]);
    }
    miniz_oxide::inflate::decompress_to_vec_with_limit(&compressed, limit).ok()
}

fn children<'a>(
    parent: Option<Node<'a, 'a>>,
    tag: &'static str,
) -> impl Iterator<Item = Node<'a, 'a>> {
    parent
        .into_iter()
        .flat_map(|n| n.children())
        .filter(move |n| n.has_tag_name((CHARTEX_NS, tag)))
}

fn results<'s, 'a: 's>(
    clears: &'s [Node<'a, 'a>],
    group: &'static str,
    item: &'static str,
) -> impl Iterator<Item = Node<'a, 'a>> + 's {
    clears
        .iter()
        .flat_map(move |&n| children(cx_child(n, group), item))
}

fn read_clear(
    clears: &[Node],
    dataset: Option<Node>,
    points: &[ChartPoint],
    view: Option<&str>,
    bing: bool,
) -> Option<GeoCache> {
    let mut regions = Vec::new();
    let mut ids = HashMap::new();
    let mut attributions = Vec::new();
    let mut remaining = MAX_VERTICES;
    let mut hierarchy = Hierarchy::read(clears);
    for item in results(
        clears,
        "geoDataEntityQueryResults",
        "geoDataEntityQueryResult",
    ) {
        let Some(data) = cx_child(item, "geoData") else {
            continue;
        };
        let query = cx_child(item, "geoDataEntityQuery");
        let geo_ids = [entity_id(data), query.and_then(entity_id)];
        let geo_bounds = bounds(data);
        let name = data.attribute("entityName").unwrap_or_default();
        let kind = query.and_then(entity_type).unwrap_or_default();
        for id in geo_ids.into_iter().flatten() {
            hierarchy.details.entry(id).or_insert((name, kind));
            if let Some(bounds) = geo_bounds {
                hierarchy.boxes.insert(id, bounds);
            }
        }
        let mut polygons = Vec::new();
        for p in children(cx_child(data, "geoPolygons"), "geoPolygon") {
            let mut fields = p.attribute("pcaRings")?.split(',');
            // The first field identifies the encoding version, not the number of rings.
            if fields.next()?.trim() != "1" {
                return None;
            }
            let rings = fields
                .map(|s| decode_ring(s.trim(), &mut remaining))
                .collect::<Option<Vec<_>>>()?;
            if !rings.is_empty() {
                polygons.push(rings);
            }
        }
        if polygons.is_empty() {
            continue;
        }
        let index = regions.len();
        for id in geo_ids.into_iter().flatten() {
            ids.entry(id).or_insert(index);
        }
        attributions.push(
            children(cx_child(data, "copyrights"), "copyright")
                .filter_map(|c| c.text())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>(),
        );
        regions.push(GeoRegion {
            name: name.to_owned(),
            entity_type: kind.to_owned(),
            point_index: None,
            in_view: true,
            in_natural_view: true,
            center: None,
            bounds: geo_bounds,
            polygons,
        });
    }
    if regions.is_empty() {
        return None;
    }
    for (&id, &i) in &ids {
        if let Some(&(name, kind)) = hierarchy.details.get(id) {
            if regions[i].entity_type.is_empty() {
                regions[i].entity_type = kind.to_owned();
            }
            if regions[i].name.is_empty() {
                regions[i].name = name.to_owned();
            }
        }
    }
    let names = location_names(clears, &ids, &mut regions, &hierarchy, view)?;
    assign_points(dataset, points, &ids, &names, &mut regions)?;
    let natural = hierarchy.natural_view(&ids, &names, &mut regions, bing);
    let explicit = hierarchy.select_view(view, &ids, &names, &mut regions, bing);
    let regional = if view == Some("world") {
        Some(false)
    } else {
        natural.map(|v| v.0)
    };
    let focus = explicit
        .or_else(|| natural.map(|v| v.1))
        .unwrap_or_default();
    let us_only = focus.us
        && !matches!(
            view,
            Some("world" | "countryRegionList" | "state" | "county" | "postalCode")
        );
    let projection_bounds = if regional == Some(false) {
        None
    } else {
        focus.bounds
    };
    let credits: BTreeSet<_> = attributions
        .iter()
        .zip(&regions)
        .filter(|(_, r)| r.in_view)
        .flat_map(|(credits, _)| credits.iter().copied())
        .collect();
    Some(GeoCache {
        regions,
        credits: credits.into_iter().map(str::to_owned).collect(),
        us_only,
        regional,
        projection_bounds,
    })
}

fn decode_ring(text: &str, remaining: &mut usize) -> Option<Vec<(f64, f64)>> {
    let mut vertices = Vec::new();
    let (mut lon, mut lat) = (0_i64, 0_i64);
    let (mut value, mut shift) = (0_u64, 0_u32);
    for b in text.bytes() {
        let digit = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'_' => 62,
            b'-' => 63,
            _ => return None,
        };
        value |= u64::from(digit & 31) << shift;
        if digit >= 32 {
            shift += 5;
            if shift > 50 {
                return None;
            }
            continue;
        }
        *remaining = remaining.checked_sub(1)?;
        // Invert the triangular pairing of two zigzag-encoded coordinate deltas.
        let mut diagonal = (((8. * value as f64 + 1.).sqrt() - 1.) * 0.5) as u64;
        let triangle = |d: u64| d * (d + 1) / 2;
        if triangle(diagonal) > value {
            diagonal -= 1;
        } else if triangle(diagonal + 1) <= value {
            diagonal += 1;
        }
        let y = value - triangle(diagonal);
        let x = diagonal.checked_sub(y)?;
        let signed = |v: u64| ((v >> 1) as i64) ^ -((v & 1) as i64);
        lon += signed(x);
        lat += signed(y);
        if !(-9_000_000..=9_000_000).contains(&lat)
            || signed(x).abs() > 36_000_000
            || (vertices.is_empty() && lon.abs() > 18_000_000)
        {
            return None;
        }
        if lon > 18_000_000 {
            lon -= 36_000_000;
        }
        if lon < -18_000_000 {
            lon += 36_000_000;
        }
        vertices.push((lon as f64 / 100_000., lat as f64 / 100_000.));
        (value, shift) = (0, 0);
    }
    (shift == 0 && vertices.len() >= 3).then_some(vertices)
}

fn coordinate(node: Node, attr: &str, limit: f64) -> Option<f64> {
    node.attribute(attr)?
        .parse()
        .ok()
        .filter(|v: &f64| v.abs() <= limit)
}

fn bounds(node: Node) -> Option<[f64; 4]> {
    let west = coordinate(node, "west", 180.)?;
    let east = coordinate(node, "east", 180.)?;
    let south = coordinate(node, "south", 90.)?;
    let north = coordinate(node, "north", 90.)?;
    (south <= north).then_some([west, south, east, north])
}

fn location(node: Node) -> Option<(f64, f64)> {
    Some((
        coordinate(node, "longitude", 180.)?,
        coordinate(node, "latitude", 90.)?,
    ))
}

fn entity_type<'a>(node: Node<'a, '_>) -> Option<&'a str> {
    node.attribute("entityType")
        .filter(|s| !s.is_empty() && s.len() <= 64)
}

fn entity_id<'a>(node: Node<'a, '_>) -> Option<&'a str> {
    node.attribute("entityId")
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= MAX_LABEL_BYTES)
}

fn coord_key((lon, lat): (f64, f64), kind: &str) -> (i32, i32, String) {
    (
        (lon * 1e6).round() as i32,
        (lat * 1e6).round() as i32,
        kind.to_ascii_lowercase(),
    )
}

fn normalized(s: &str) -> String {
    if s.len() > MAX_LABEL_BYTES {
        return String::new();
    }
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn insert_name(names: &mut HashSet<String>, s: Option<&str>) {
    if let Some(s) = s {
        let s = normalized(s);
        if !s.is_empty() {
            names.insert(s);
        }
    }
}

#[derive(Default)]
struct Names {
    leaf: HashSet<String>,
    context: HashSet<String>,
    scope: HashSet<String>,
    country: HashSet<String>,
    country_is_us: Option<bool>,
}

fn unique_key<K: std::hash::Hash + Eq>(map: &mut HashMap<K, Option<usize>>, key: K, i: usize) {
    map.entry(key)
        .and_modify(|v| {
            if *v != Some(i) {
                *v = None;
            }
        })
        .or_insert(Some(i));
}

fn location_names(
    clears: &[Node],
    ids: &HashMap<&str, usize>,
    regions: &mut [GeoRegion],
    hierarchy: &Hierarchy,
    view: Option<&str>,
) -> Option<Vec<Names>> {
    let mut names = Vec::with_capacity(regions.len());
    let mut by_name = HashMap::<String, Vec<usize>>::new();
    for (i, region) in regions.iter().enumerate() {
        let mut n = Names::default();
        insert_name(&mut n.leaf, Some(&region.name));
        if region.entity_type.eq_ignore_ascii_case("countryRegion") {
            insert_name(&mut n.country, Some(&region.name));
        }
        if let Some(name) = n.leaf.iter().next() {
            by_name.entry(name.to_owned()).or_default().push(i);
        }
        names.push(n);
    }
    let mut by_position = HashMap::new();
    for item in results(
        clears,
        "geoDataPointToEntityQueryResults",
        "geoDataPointToEntityQueryResult",
    ) {
        let Some(point) = cx_child(item, "geoDataPointQuery") else {
            continue;
        };
        let Some(id) = cx_child(item, "geoDataPointToEntityQuery").and_then(entity_id) else {
            continue;
        };
        if let (Some(pos), Some(&i)) = (location(point), ids.get(id)) {
            unique_key(
                &mut by_position,
                coord_key(pos, entity_type(point).unwrap_or_default()),
                i,
            );
        }
    }
    let mut work = MAX_VERTICES;
    for item in results(clears, "geoLocationQueryResults", "geoLocationQueryResult") {
        let query = cx_child(item, "geoLocationQuery");
        for loc in children(cx_child(item, "geoLocations"), "geoLocation") {
            let kind = entity_type(loc)
                .or_else(|| query.and_then(entity_type))
                .unwrap_or_default();
            let pos = location(loc);
            let name = loc.attribute("entityName").unwrap_or_default();
            let i = if let Some(i) =
                pos.and_then(|p| by_position.get(&coord_key(p, kind)).copied().flatten())
            {
                i
            } else {
                let Some(candidates) = by_name.get(&normalized(name)) else {
                    continue;
                };
                work = work.checked_sub(candidates.len())?;
                let mut matching = candidates.iter().copied().filter(|&i| {
                    let g = &regions[i];
                    if !kind.is_empty()
                        && !g.entity_type.is_empty()
                        && !g.entity_type.eq_ignore_ascii_case(kind)
                    {
                        return false;
                    }
                    match (pos, g.bounds) {
                        (Some((lon, lat)), Some([west, south, east, north])) => {
                            (south..=north).contains(&lat)
                                && if west <= east {
                                    (west..=east).contains(&lon)
                                } else {
                                    lon >= west || lon <= east
                                }
                        }
                        _ => true,
                    }
                });
                let Some(i) = matching.next() else { continue };
                if matching.next().is_some() {
                    continue;
                }
                i
            };
            regions[i].center = regions[i].center.or(pos);
            insert_name(&mut names[i].leaf, Some(name));
            let address = cx_child(loc, "address");
            let country = address
                .and_then(|a| a.attribute("isoCountryCode"))
                .map(str::trim)
                .filter(|code| code.len() == 2 && code.bytes().all(|b| b.is_ascii_alphabetic()))
                .map(|code| code.eq_ignore_ascii_case("US"))
                .or_else(|| {
                    [address, query]
                        .into_iter()
                        .flatten()
                        .filter_map(|a| a.attribute("countryRegion"))
                        .any(us_name)
                        .then_some(true)
                });
            if let Some(country) = country {
                names[i].country_is_us = Some(names[i].country_is_us.unwrap_or(true) && country);
            }
            let leaf_attr = match kind.to_ascii_lowercase().as_str() {
                "countryregion" => "countryRegion",
                "admindistrict" | "admindistrict1" => "adminDistrict1",
                "admindistrict2" => "adminDistrict2",
                "admindistrict3" => "adminDistrict3",
                "postalcode" => "postalCode",
                "address" => "address1",
                "locality" => "locality",
                _ => "",
            };
            for address in [query, address].into_iter().flatten() {
                for field in [
                    "countryRegion",
                    "isoCountryCode",
                    "adminDistrict1",
                    "adminDistrict2",
                    "adminDistrict3",
                    "locality",
                    "address1",
                    "postalCode",
                ] {
                    if matches!(field, "countryRegion" | "isoCountryCode") {
                        insert_name(&mut names[i].country, address.attribute(field));
                    }
                    if field == leaf_attr
                        || (leaf_attr == "countryRegion" && field == "isoCountryCode")
                    {
                        insert_name(&mut names[i].leaf, address.attribute(field));
                    } else {
                        insert_name(&mut names[i].context, address.attribute(field));
                    }
                    if matches!(
                        (view, field),
                        (Some("countryRegion"), "countryRegion" | "isoCountryCode")
                            | (Some("state"), "adminDistrict1")
                            | (Some("county"), "adminDistrict2")
                            | (Some("postalCode"), "postalCode")
                    ) {
                        insert_name(&mut names[i].scope, address.attribute(field));
                    }
                }
            }
        }
    }
    for (&id, &i) in ids {
        insert_name(&mut names[i].leaf, hierarchy.details.get(id).map(|e| e.0));
        for parent in hierarchy.parents.get(id).into_iter().flatten() {
            let label = hierarchy
                .details
                .get(parent)
                .map(|e| e.0)
                .or_else(|| ids.get(parent).map(|&j| regions[j].name.as_str()));
            insert_name(&mut names[i].context, label);
        }
    }
    Some(names)
}

fn assign_points(
    dataset: Option<Node>,
    points: &[ChartPoint],
    ids: &HashMap<&str, usize>,
    names: &[Names],
    regions: &mut [GeoRegion],
) -> Option<()> {
    let mut explicit = HashSet::new();
    for dim in children(dataset, "strDim").filter(|d| d.attribute("type") == Some("entityId")) {
        for lvl in children(Some(dim), "lvl") {
            for p in children(Some(lvl), "pt") {
                let Some(idx) = p.attribute("idx").and_then(|s| s.parse::<u32>().ok()) else {
                    continue;
                };
                let Some(id) = p.text().map(str::trim).filter(|s| !s.is_empty()) else {
                    continue;
                };
                if !explicit.insert(idx) {
                    continue;
                }
                if let Some(&i) = ids.get(id) {
                    regions[i].point_index.get_or_insert(idx);
                }
            }
        }
    }
    let mut by_leaf = HashMap::<&str, Vec<usize>>::new();
    for (i, n) in names.iter().enumerate() {
        for alias in &n.leaf {
            by_leaf.entry(alias).or_default().push(i);
        }
    }
    let mut work = MAX_VERTICES;
    for point in points.iter().filter(|p| !explicit.contains(&p.index)) {
        let Some(leaf) = point
            .categories
            .iter()
            .filter(|c| !c.label.trim().is_empty())
            .min_by_key(|c| c.level)
        else {
            continue;
        };
        let Some(candidates) = by_leaf.get(normalized(&leaf.label).as_str()) else {
            continue;
        };
        work = work.checked_sub(candidates.len().checked_mul(point.categories.len())?)?;
        let parents: Vec<_> = point
            .categories
            .iter()
            .filter(|c| c.level > leaf.level)
            .map(|c| normalized(&c.label))
            .collect();
        let mut best = None;
        let mut best_score = None;
        for &i in candidates {
            let score = parents
                .iter()
                .filter(|p| names[i].context.contains(p.as_str()))
                .count();
            match best_score {
                Some(s) if s > score => (),
                Some(s) if s == score => best = None,
                _ => {
                    best_score = Some(score);
                    best = Some(i);
                }
            }
        }
        if let Some(i) = best {
            regions[i].point_index.get_or_insert(point.index);
        }
    }
    Some(())
}

fn us_name(s: &str) -> bool {
    matches!(
        normalized(s).as_str(),
        "us" | "usa" | "unitedstates" | "unitedstatesofamerica"
    )
}
