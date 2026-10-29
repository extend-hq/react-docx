use std::{cell::RefCell, collections::HashMap, marker::PhantomData};

use crate::xml::{TagRange, TaggedRange};

struct Element {
    start: u32,
    open_end: u32,
    end: u32,
    name_start: u32,
    name_end: u32,
    parent: u32,
    next: u32,
    name_id: u32,
}

#[derive(Default)]
struct TagCache {
    start: usize,
    end: usize,
    first: Vec<u32>,
}

pub(crate) struct Index {
    address: usize,
    len: usize,
    elements: Vec<Element>,
    names: HashMap<String, usize>,
    named_elements: Vec<Vec<usize>>,
    tag_cache: RefCell<TagCache>,
}

impl Index {
    pub(crate) fn build(xml: &str) -> Option<Self> {
        Self::build_impl::<false>(xml)
    }

    pub(crate) fn canonical(xml: &str) -> Option<Self> {
        if xml.contains('\r') {
            return None;
        }
        Self::build_impl::<true>(xml)
    }

    fn build_impl<const CANONICAL: bool>(xml: &str) -> Option<Self> {
        if xml.len() > u32::MAX as usize {
            return None;
        }
        let mut index = Self {
            address: xml.as_ptr() as usize,
            len: xml.len(),
            elements: Vec::new(),
            names: HashMap::new(),
            named_elements: Vec::new(),
            tag_cache: RefCell::new(TagCache::default()),
        };
        let mut interned = HashMap::<&str, usize>::new();
        let mut stack = Vec::<usize>::new();
        let mut canonical = Canonical::default();
        let mut roots = 0;
        let mut cursor = 0;
        while let Some(offset) = xml[cursor..].find('<') {
            let start = cursor + offset;
            if CANONICAL && !canonical.text(&xml[cursor..start], stack.is_empty()) {
                return None;
            }
            let end = if CANONICAL {
                start + xml[start..].find('>')? + 1
            } else {
                crate::xml::tag_token_end(xml, start)?
            };
            cursor = end;
            let token = &xml[start..end];
            if !CANONICAL && token[1..].contains('<') {
                return None;
            }
            if token.starts_with("<?") {
                if CANONICAL
                    && !matches!(
                        quick_xml::Reader::from_str(token).read_event(),
                        Ok(quick_xml::events::Event::Decl(_))
                    )
                {
                    return None;
                }
                continue;
            }
            if token.starts_with("<!") {
                return None;
            }
            let closing = token.starts_with("</");
            let name_start = start + if closing { 2 } else { 1 };
            let name_len = xml[name_start..end]
                .find(|ch: char| ch.is_ascii_whitespace() || ch == '/' || ch == '>')?;
            let name_end = name_start + name_len;
            let name = &xml[name_start..name_end];
            if name.is_empty()
                || !name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b':')
            {
                return None;
            }
            if closing {
                if name_end + 1 != end {
                    return None;
                }
                let id = stack.pop()?;
                let next = index.elements.len();
                let element = &mut index.elements[id];
                if xml[element.name_start as usize..element.name_end as usize] != *name {
                    return None;
                }
                element.end = end as u32;
                element.next = next as u32;
            } else {
                if CANONICAL {
                    if stack.is_empty() {
                        roots += 1;
                    }
                    if !canonical.open(name, &xml[name_end..end], stack.is_empty()) {
                        return None;
                    }
                }
                let id = index.elements.len();
                let empty = token.ends_with("/>");
                let name_id = *interned.entry(name).or_insert_with(|| {
                    let lower = name.to_ascii_lowercase();
                    let name_id = if let Some(name_id) = index.names.get(&lower) {
                        *name_id
                    } else {
                        let name_id = index.named_elements.len();
                        index.named_elements.push(Vec::new());
                        index.names.insert(lower, name_id);
                        name_id
                    };
                    if name.bytes().any(|b| b.is_ascii_uppercase()) {
                        index.names.insert(name.to_owned(), name_id);
                    }
                    name_id
                });
                index.elements.push(Element {
                    start: start as u32,
                    open_end: end as u32,
                    end: if empty { end as u32 } else { 0 },
                    name_start: name_start as u32,
                    name_end: name_end as u32,
                    parent: stack.last().map(|id| *id as u32).unwrap_or(u32::MAX),
                    next: (id + 1) as u32,
                    name_id: name_id as u32,
                });
                index.named_elements[name_id].push(id);
                if !empty {
                    stack.push(id);
                }
            }
        }
        if CANONICAL && (roots != 1 || !canonical.text(&xml[cursor..], stack.is_empty())) {
            return None;
        }
        stack.is_empty().then_some(index)
    }

    fn name_id(&self, name: &str) -> Option<usize> {
        if let Some(id) = self.names.get(name) {
            return Some(*id);
        }
        if !name.bytes().any(|b| b.is_ascii_uppercase()) {
            return None;
        }
        let mut folded = [0u8; 128];
        let id = if name.len() <= folded.len() {
            for (out, byte) in folded.iter_mut().zip(name.bytes()) {
                *out = byte.to_ascii_lowercase();
            }
            self.names
                .get(std::str::from_utf8(&folded[..name.len()]).ok()?)?
        } else {
            self.names.get(&name.to_ascii_lowercase())?
        };
        Some(*id)
    }

    fn named(&self, name: &str) -> Option<&[usize]> {
        Some(&self.named_elements[self.name_id(name)?])
    }
}

#[derive(Default)]
struct Canonical<'a> {
    bindings: HashMap<&'a str, &'a str>,
    attributes: Vec<&'a str>,
}

impl<'a> Canonical<'a> {
    fn text(&self, text: &str, outside: bool) -> bool {
        if outside {
            return text.bytes().all(|b| b.is_ascii_whitespace());
        }
        let mut remaining = text;
        while let Some(start) = remaining.find('&') {
            let Some((name, rest)) = remaining[start + 1..].split_once(';') else {
                return false;
            };
            if !matches!(name, "amp" | "lt" | "gt" | "quot" | "apos") {
                let code = name
                    .strip_prefix("#x")
                    .or_else(|| name.strip_prefix("#X"))
                    .and_then(|digits| u32::from_str_radix(digits, 16).ok())
                    .or_else(|| {
                        name.strip_prefix('#')
                            .and_then(|digits| digits.parse::<u32>().ok())
                    });
                if !code.is_some_and(|code| {
                    code >= 0x20
                        && !matches!(code, 0xfffe | 0xffff)
                        && char::from_u32(code).is_some()
                }) {
                    return false;
                }
            }
            remaining = rest;
        }
        true
    }

    fn open(&mut self, name: &'a str, mut tail: &'a str, root: bool) -> bool {
        self.attributes.clear();
        loop {
            let trimmed = tail.trim_start_matches(|ch: char| ch.is_ascii_whitespace());
            if matches!(trimmed, ">" | "/>") {
                break;
            }
            if trimmed.len() == tail.len() {
                return false;
            }
            let Some(key_end) = trimmed.find('=') else {
                return false;
            };
            let key = &trimmed[..key_end];
            if key.is_empty()
                || !key
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b':' | b'-' | b'.'))
                || self.attributes.contains(&key)
            {
                return false;
            }
            let Some(value_tail) = trimmed[key_end + 1..].strip_prefix('"') else {
                return false;
            };
            let Some((value, rest)) = value_tail.split_once('"') else {
                return false;
            };
            if value
                .bytes()
                .any(|b| matches!(b, b'\n' | b'\t' | b'<' | b'>'))
                || value.split('&').skip(1).any(|reference| {
                    !["amp;", "lt;", "gt;", "quot;"]
                        .iter()
                        .any(|entity| reference.starts_with(entity))
                })
            {
                return false;
            }
            self.attributes.push(key);
            if key == "xmlns" || key.starts_with("xmlns:") {
                let declared = key.strip_prefix("xmlns:").unwrap_or("");
                if (!root && !self.bindings.contains_key(declared)) || value.contains('&') {
                    return false;
                }
                if let Some(expected) = crate::parse::canonical_namespace_prefix(value) {
                    if declared != expected {
                        return false;
                    }
                } else if declared.is_empty()
                    || [
                        "w", "r", "a", "m", "c", "wp", "pic", "wps", "wpg", "mc", "w14", "w15",
                        "v", "o", "xml", "wp14", "w10",
                    ]
                    .contains(&declared)
                {
                    return false;
                }
                if self.bindings.get(declared).is_some_and(|old| *old != value)
                    || self
                        .bindings
                        .iter()
                        .any(|(key, old)| *old == value && *key != declared)
                {
                    return false;
                }
                self.bindings.entry(declared).or_insert(value);
            }
            tail = rest;
        }
        if name
            .split_once(':')
            .is_some_and(|(prefix, _)| prefix != "xml" && !self.bindings.contains_key(prefix))
        {
            return false;
        }
        !self.attributes.iter().any(|key| {
            key.split_once(':').is_some_and(|(prefix, _)| {
                prefix != "xml" && prefix != "xmlns" && !self.bindings.contains_key(prefix)
            })
        })
    }
}

thread_local! {
    static INDEXES: RefCell<Vec<Index>> = const { RefCell::new(Vec::new()) };
}

// Source borrows and thread affinity keep address-based lookups valid for the scope.
pub(crate) struct Scope<'a> {
    previous: Vec<Index>,
    source: PhantomData<std::rc::Rc<&'a str>>,
}

pub(crate) fn scope<'a>(
    parts: impl Iterator<Item = (&'a str, &'a str)>,
    mut prepared: HashMap<String, Index>,
) -> Scope<'a> {
    let mut indexes: Vec<_> = parts
        .filter_map(|(name, xml)| {
            let mut index = prepared.remove(name).or_else(|| Index::build(xml))?;
            index.address = xml.as_ptr() as usize;
            Some(index)
        })
        .collect();
    indexes.sort_unstable_by_key(|index| index.address);
    Scope {
        previous: INDEXES.with(|current| current.replace(indexes)),
        source: PhantomData,
    }
}

impl Drop for Scope<'_> {
    fn drop(&mut self) {
        INDEXES.with(|current| current.replace(std::mem::take(&mut self.previous)));
    }
}

fn lookup<T>(xml: &str, visit: impl FnOnce(&Index, usize, usize) -> T) -> Option<T> {
    if xml.is_empty() {
        return None;
    }
    INDEXES.with(|indexes| {
        let indexes = indexes.borrow();
        let address = xml.as_ptr() as usize;
        let position = indexes
            .partition_point(|index| index.address <= address)
            .checked_sub(1)?;
        let index = &indexes[position];
        let start = address - index.address;
        let end = start.checked_add(xml.len())?;
        (end <= index.len).then(|| visit(index, start, end))
    })
}

pub(crate) fn tag<'a>(xml: &'a str, name: &str) -> Option<Option<&'a str>> {
    lookup(xml, |index, start, end| {
        let name_id = index.name_id(name)?;
        let element_id = if xml.len() <= 2048 {
            let mut cache = index.tag_cache.borrow_mut();
            if cache.start != start || cache.end != end || cache.first.is_empty() {
                cache.start = start;
                cache.end = end;
                cache.first.resize(index.named_elements.len(), u32::MAX);
                cache.first.fill(u32::MAX);
                let first = index
                    .elements
                    .partition_point(|element| (element.start as usize) < start);
                for (id, element) in index.elements.iter().enumerate().skip(first) {
                    if element.open_end as usize > end {
                        break;
                    }
                    let target = &mut cache.first[element.name_id as usize];
                    if *target == u32::MAX {
                        *target = id as u32;
                    }
                }
            }
            let id = cache.first[name_id];
            if id == u32::MAX {
                return None;
            }
            id as usize
        } else {
            let names = &index.named_elements[name_id];
            let pos = names.partition_point(|id| (index.elements[*id].start as usize) < start);
            *names.get(pos)?
        };
        let element = &index.elements[element_id];
        ((element.open_end as usize) <= end)
            .then(|| &xml[element.start as usize - start..element.open_end as usize - start])
    })
}

pub(crate) fn contains_local_names(xml: &str, names: &[&str]) -> Option<bool> {
    lookup(xml, |index, _, _| {
        index.names.keys().any(|name| {
            let local = name.rsplit(':').next().unwrap_or(name);
            names.iter().any(|name| local.eq_ignore_ascii_case(name))
        })
    })
}

pub(crate) fn ranges(xml: &str, name: &str) -> Option<Vec<TagRange>> {
    lookup(xml, |index, start, end| {
        let mut result = Vec::new();
        let Some(names) = index.named(name) else {
            return result;
        };
        let pos = names.partition_point(|id| (index.elements[*id].start as usize) < start);
        let mut covered = start;
        for id in &names[pos..] {
            let element = &index.elements[*id];
            if (element.start as usize) >= end {
                break;
            }
            if (element.start as usize) < covered {
                continue;
            }
            covered = element.end as usize;
            if (element.end as usize) <= end {
                result.push(TagRange {
                    start: (element.start as usize) - start,
                    end: (element.end as usize) - start,
                });
            }
        }
        result
    })
}

pub(crate) fn children(xml: &str) -> Option<Vec<TaggedRange>> {
    lookup(xml, |index, start, end| {
        let root = index
            .elements
            .partition_point(|element| (element.start as usize) < start);
        let element = index.elements.get(root)?;
        if (element.start as usize) != start || (element.end as usize) > end {
            return None;
        }
        let mut result = Vec::new();
        let mut child = root + 1;
        while child < (element.next as usize) {
            let node = &index.elements[child];
            if node.parent != root as u32 {
                return None;
            }
            result.push(TaggedRange {
                start: (node.start as usize) - start,
                end: (node.end as usize) - start,
                tag_name: xml[(node.name_start as usize) - start..(node.name_end as usize) - start]
                    .to_owned(),
            });
            child = node.next as usize;
        }
        Some(result)
    })
    .flatten()
}

pub(crate) fn for_each_child<'a>(
    xml: &'a str,
    mut visit: impl FnMut(&'a str, &'a str) -> bool,
) -> Option<bool> {
    lookup(xml, |index, start, end| {
        let root = index
            .elements
            .partition_point(|element| (element.start as usize) < start);
        let element = index.elements.get(root)?;
        if element.start as usize != start || element.end as usize > end {
            return None;
        }
        let mut child = root + 1;
        while child < element.next as usize {
            let node = &index.elements[child];
            if node.parent != root as u32 {
                return None;
            }
            if !visit(
                &xml[node.name_start as usize - start..node.name_end as usize - start],
                &xml[node.start as usize - start..node.end as usize - start],
            ) {
                return Some(false);
            }
            child = node.next as usize;
        }
        Some(true)
    })
    .flatten()
}

pub(crate) fn child<'a>(xml: &'a str, name: &str) -> Option<Option<&'a str>> {
    lookup(xml, |index, start, end| {
        let root = index
            .elements
            .partition_point(|element| (element.start as usize) < start);
        let element = index.elements.get(root)?;
        if (element.start as usize) != start || (element.end as usize) > end {
            return None;
        }
        let mut child = root + 1;
        while child < (element.next as usize) {
            let node = &index.elements[child];
            if node.parent != root as u32 {
                return None;
            }
            if xml[(node.name_start as usize) - start..(node.name_end as usize) - start]
                .eq_ignore_ascii_case(name)
            {
                return Some(Some(
                    &xml[(node.start as usize) - start..(node.end as usize) - start],
                ));
            }
            child = node.next as usize;
        }
        Some(None)
    })
    .flatten()
}
