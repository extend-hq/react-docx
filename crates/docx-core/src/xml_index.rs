use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    marker::PhantomData,
};

use crate::xml::{TagRange, TaggedRange};

struct Element {
    start: u32,
    open_end: u32,
    end: u32,
    parent: u32,
    next: u32,
    name_id: u32,
}

impl Element {
    fn name_range(&self, names: &[NamedElements], offset: usize) -> std::ops::Range<usize> {
        let start = self.start as usize + 1 - offset;
        start..start + names[self.name_id as usize].name_len as usize
    }
}

struct NamedElements {
    positions: Vec<u32>,
    name_len: u32,
}

#[derive(Default)]
struct TagCache {
    start: usize,
    end: usize,
    first: Vec<u32>,
}

#[derive(Clone, Default)]
struct NameCacheEntry {
    name: [u8; 32],
    len: u8,
    id: Option<usize>,
}

pub(crate) struct Index {
    address: usize,
    len: usize,
    elements: Vec<Element>,
    names: HashMap<String, usize>,
    named_elements: Vec<NamedElements>,
    tag_cache: RefCell<TagCache>,
    name_cache: RefCell<Vec<NameCacheEntry>>,
    canonical: bool,
    serialization_equivalent: bool,
}

impl Index {
    pub(crate) fn build(xml: &str) -> Option<Self> {
        Self::build_impl::<false, false, false, false>(xml).map(|(index, _)| index)
    }

    pub(crate) fn canonical(xml: &str) -> Option<Self> {
        if memchr::memchr(b'\r', xml.as_bytes()).is_some() {
            return None;
        }
        Self::build_impl::<true, false, false, false>(xml).map(|(index, _)| index)
    }

    pub(crate) fn canonical_serialized(xml: &str) -> Option<Self> {
        if memchr::memchr(b'\r', xml.as_bytes()).is_some() {
            return None;
        }
        Self::build_impl::<true, true, false, false>(xml).map(|(index, _)| index)
    }

    pub(crate) fn canonical_normalized(xml: &str) -> Option<Self> {
        if memchr::memchr(b'\r', xml.as_bytes()).is_some() {
            return None;
        }
        Self::build_impl::<true, false, true, false>(xml).map(|(index, _)| index)
    }

    pub(crate) fn serialization_equivalent(&self) -> bool {
        self.serialization_equivalent
    }

    pub(crate) fn canonical_hoisted(xml: &str) -> Option<(String, Self)> {
        let (index, xml) = Self::build_impl::<true, true, true, true>(xml)?;
        Some((xml?, index))
    }

    fn build_impl<
        const CANONICAL: bool,
        const SERIALIZED: bool,
        const NORMALIZED: bool,
        const HOIST: bool,
    >(
        xml: &str,
    ) -> Option<(Self, Option<String>)> {
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
            name_cache: RefCell::new(Vec::new()),
            canonical: CANONICAL,
            serialization_equivalent: false,
        };
        let mut interned = HashMap::<&str, usize>::new();
        let mut name_cache = [("", 0usize); 128];
        let mut open_cache = [""; 128];
        let mut stack = Vec::<usize>::new();
        let mut canonical = Canonical {
            serialized: true,
            ..Canonical::default()
        };
        let mut roots = 0;
        let mut root_name_end = 0;
        let mut cursor = 0;
        while let Some(offset) = memchr::memchr(b'<', &xml.as_bytes()[cursor..]) {
            let start = cursor + offset;
            if CANONICAL
                && cursor != start
                && !canonical.text::<SERIALIZED>(&xml[cursor..start], stack.is_empty())
            {
                return None;
            }
            let end = if CANONICAL {
                start + memchr::memchr(b'>', &xml.as_bytes()[start..])? + 1
            } else {
                crate::xml::tag_token_end(xml, start)?
            };
            cursor = end;
            let token = &xml[start..end];
            if !CANONICAL && memchr::memchr(b'<', &token.as_bytes()[1..]).is_some() {
                return None;
            }
            if token.starts_with("<?") {
                if HOIST {
                    return None;
                }
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
            if token.starts_with("</") {
                if HOIST {
                    canonical.close_scope(stack.len().checked_sub(1)?);
                }
                let id = stack.pop()?;
                let next = index.elements.len();
                let element = &mut index.elements[id];
                if xml.as_bytes()[element.name_range(&index.named_elements, 0)]
                    != xml.as_bytes()[start + 2..end - 1]
                {
                    return None;
                }
                if SERIALIZED && element.open_end as usize == start {
                    if HOIST {
                        canonical.edits.push((start - 1, start, "/>".to_owned()));
                        canonical.edits.push((start, end, String::new()));
                    } else {
                        canonical.serialized = false;
                    }
                }
                element.end = end as u32;
                element.next = next as u32;
            } else {
                let name_start = start + 1;
                let mut name_end = name_start;
                loop {
                    let byte = *xml.as_bytes().get(name_end)?;
                    if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b':') {
                        name_end += 1;
                    } else if byte.is_ascii_whitespace() || matches!(byte, b'/' | b'>') {
                        break;
                    } else {
                        return None;
                    }
                }
                if name_end == name_start {
                    return None;
                }
                let name = &xml[name_start..name_end];
                if SERIALIZED && !canonical_name(name) {
                    canonical.serialized = false;
                }
                if CANONICAL {
                    if stack.is_empty() {
                        roots += 1;
                    }
                    let root = stack.is_empty();
                    if root {
                        root_name_end = name_end;
                    }
                    let cacheable = !HOIST
                        || (canonical
                            .activations
                            .last()
                            .is_none_or(|(depth, _)| *depth == 0)
                            && !token.contains("xmlns")
                            && !token.contains("&#"));
                    let bytes = token.as_bytes();
                    let slot = (bytes.len().wrapping_mul(31)
                        ^ ((bytes[1] as usize) << 3)
                        ^ ((bytes[bytes.len() / 2] as usize) << 1)
                        ^ bytes[bytes.len() - 2] as usize)
                        & (open_cache.len() - 1);
                    // Non-root declarations cannot change a validated namespace binding.
                    // Exact tokens can reuse that proof; serialization failure is monotonic.
                    if root || !cacheable || open_cache[slot] != token {
                        if !canonical.open::<SERIALIZED, NORMALIZED, HOIST>(
                            name,
                            &xml[name_end..end],
                            root,
                            stack.len(),
                            xml.as_ptr() as usize,
                        ) {
                            return None;
                        }
                        if !root && cacheable && token.len() <= 256 {
                            open_cache[slot] = token;
                        }
                    }
                }
                let id = index.elements.len();
                if id == 0 {
                    index.elements.reserve((xml.len() / 48).min(65536));
                }
                let empty = token.ends_with("/>");
                let bytes = name.as_bytes();
                let slot = (bytes.len().wrapping_mul(31)
                    ^ ((bytes[0] as usize) << 3)
                    ^ ((bytes[bytes.len() / 2] as usize) << 1)
                    ^ bytes[bytes.len() - 1] as usize)
                    & (name_cache.len() - 1);
                let name_id = if name_cache[slot].0 == name {
                    name_cache[slot].1
                } else {
                    let name_id = *interned.entry(name).or_insert_with(|| {
                        let lower = name.to_ascii_lowercase();
                        let name_id = if let Some(name_id) = index.names.get(&lower) {
                            *name_id
                        } else {
                            let name_id = index.named_elements.len();
                            // ASCII case folding preserves the QName byte length.
                            index.named_elements.push(NamedElements {
                                positions: Vec::new(),
                                name_len: name.len() as u32,
                            });
                            index.names.insert(lower, name_id);
                            name_id
                        };
                        if name.bytes().any(|b| b.is_ascii_uppercase()) {
                            index.names.insert(name.to_owned(), name_id);
                        }
                        name_id
                    });
                    name_cache[slot] = (name, name_id);
                    name_id
                };
                index.elements.push(Element {
                    start: start as u32,
                    open_end: end as u32,
                    end: if empty { end as u32 } else { 0 },
                    parent: stack.last().map(|id| *id as u32).unwrap_or(u32::MAX),
                    next: (id + 1) as u32,
                    name_id: name_id as u32,
                });
                // Each element consumes XML bytes, so the input size bound also bounds IDs.
                index.named_elements[name_id].positions.push(id as u32);
                if !empty {
                    stack.push(id);
                } else if HOIST {
                    canonical.close_scope(stack.len());
                }
            }
        }
        if CANONICAL
            && (roots != 1 || !canonical.text::<SERIALIZED>(&xml[cursor..], stack.is_empty()))
        {
            return None;
        }
        index.serialization_equivalent = SERIALIZED && canonical.serialized;
        if !stack.is_empty() {
            return None;
        }
        if HOIST {
            if !canonical.serialized {
                return None;
            }
            let mut bindings: Vec<_> = canonical.bindings.iter().collect();
            bindings.sort_unstable_by_key(|(name, _)| **name);
            let mut declarations = String::new();
            for (name, uri) in bindings {
                if *name == "xml" {
                    continue;
                }
                declarations.push_str(" xmlns");
                if !name.is_empty() {
                    declarations.push(':');
                    declarations.push_str(name);
                }
                declarations.push_str("=\"");
                declarations.push_str(uri);
                declarations.push('"');
            }
            canonical
                .edits
                .push((root_name_end, root_name_end, declarations));
            canonical
                .edits
                .sort_unstable_by_key(|(start, end, _)| (*start, *end));
            let mut out = String::with_capacity(xml.len());
            let mut offsets = Vec::with_capacity(canonical.edits.len());
            let mut cursor = 0;
            let mut delta = 0i64;
            for (start, end, replacement) in canonical.edits {
                if start < cursor || end > xml.len() {
                    return None;
                }
                out.push_str(&xml[cursor..start]);
                out.push_str(&replacement);
                delta += replacement.len() as i64 - (end - start) as i64;
                offsets.push((end, delta));
                cursor = end;
            }
            out.push_str(&xml[cursor..]);
            if out.len() > u32::MAX as usize {
                return None;
            }
            let translate = |offset: u32| {
                let at = offsets.partition_point(|(end, _)| *end <= offset as usize);
                (offset as i64 + if at == 0 { 0 } else { offsets[at - 1].1 }) as u32
            };
            for element in &mut index.elements {
                element.start = translate(element.start);
                element.open_end = translate(element.open_end);
                element.end = translate(element.end);
            }
            index.address = out.as_ptr() as usize;
            index.len = out.len();
            return Some((index, Some(out)));
        }
        Some((index, None))
    }

    fn name_id(&self, name: &str) -> Option<usize> {
        if name.is_empty() || name.len() > 32 {
            return self.find_name_id(name);
        }
        let bytes = name.as_bytes();
        let slot = (bytes.len().wrapping_mul(31)
            ^ ((bytes[0] as usize) << 3)
            ^ ((bytes[bytes.len() / 2] as usize) << 1)
            ^ bytes[bytes.len() - 1] as usize)
            & 127;
        let mut cache = self.name_cache.borrow_mut();
        if cache.is_empty() {
            cache.resize(128, NameCacheEntry::default());
        }
        let entry = &mut cache[slot];
        if entry.len as usize == bytes.len() && &entry.name[..bytes.len()] == bytes {
            return entry.id;
        }
        let id = self.find_name_id(name);
        entry.name[..bytes.len()].copy_from_slice(bytes);
        entry.len = bytes.len() as u8;
        entry.id = id;
        id
    }

    fn find_name_id(&self, name: &str) -> Option<usize> {
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

    fn named(&self, name: &str) -> Option<&[u32]> {
        Some(&self.named_elements[self.name_id(name)?].positions)
    }
}

#[derive(Default)]
struct Canonical<'a> {
    bindings: HashMap<&'a str, &'a str>,
    attributes: Vec<&'a str>,
    bound_prefixes: u32,
    serialized: bool,
    active_unknown: HashSet<&'a str>,
    activations: Vec<(usize, &'a str)>,
    edits: Vec<(usize, usize, String)>,
}

fn canonical_name(name: &str) -> bool {
    let mut count = 0;
    name.split(':').all(|part| {
        count += 1;
        count <= 2
            && part
                .as_bytes()
                .first()
                .is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'_')
    })
}

impl<'a> Canonical<'a> {
    fn prefix_bit(prefix: &str) -> u32 {
        match prefix {
            "w" => 1,
            "r" => 2,
            "a" => 4,
            "m" => 8,
            "c" => 16,
            "wp" => 32,
            "pic" => 64,
            "wps" => 128,
            "wpg" => 256,
            "mc" => 512,
            "w14" => 1024,
            "w15" => 2048,
            "v" => 4096,
            "o" => 8192,
            "wp14" => 16384,
            "w10" => 32768,
            _ => 0,
        }
    }

    fn is_bound<const HOIST: bool>(&self, prefix: &str) -> bool {
        let bit = Self::prefix_bit(prefix);
        if bit != 0 {
            return self.bound_prefixes & bit != 0;
        }
        prefix == "xml"
            || if HOIST {
                self.active_unknown.contains(prefix)
            } else {
                self.bindings.contains_key(prefix)
            }
    }

    fn close_scope(&mut self, depth: usize) {
        while self
            .activations
            .last()
            .is_some_and(|(level, _)| *level == depth)
        {
            let (_, prefix) = self.activations.pop().unwrap();
            self.bound_prefixes &= !Self::prefix_bit(prefix);
            self.active_unknown.remove(prefix);
        }
    }

    fn text<const SERIALIZED: bool>(&mut self, text: &str, outside: bool) -> bool {
        if outside {
            return text.bytes().all(|b| b.is_ascii_whitespace());
        }
        if SERIALIZED && memchr::memchr(b'>', text.as_bytes()).is_some() {
            self.serialized = false;
        }
        let mut remaining = text;
        while let Some(start) = memchr::memchr(b'&', remaining.as_bytes()) {
            let tail = &remaining[start + 1..];
            let Some(end) = memchr::memchr(b';', tail.as_bytes()) else {
                return false;
            };
            let (name, rest) = (&tail[..end], &tail[end + 1..]);
            if SERIALIZED && !matches!(name, "amp" | "lt" | "gt") {
                self.serialized = false;
            }
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

    fn open<const SERIALIZED: bool, const NORMALIZED: bool, const HOIST: bool>(
        &mut self,
        name: &'a str,
        mut tail: &'a str,
        root: bool,
        depth: usize,
        base: usize,
    ) -> bool {
        self.attributes.clear();
        loop {
            let whitespace = tail
                .as_bytes()
                .iter()
                .position(|byte| !byte.is_ascii_whitespace())
                .unwrap_or(tail.len());
            let trimmed = &tail[whitespace..];
            if matches!(trimmed, ">" | "/>") {
                if SERIALIZED && whitespace != 0 {
                    self.serialized = false;
                }
                break;
            }
            if trimmed.len() == tail.len() {
                return false;
            }
            if SERIALIZED && (whitespace != 1 || tail.as_bytes()[0] != b' ') {
                self.serialized = false;
            }
            let Some(key_end) = memchr::memchr(b'=', trimmed.as_bytes()) else {
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
            if SERIALIZED && !canonical_name(key) {
                self.serialized = false;
            }
            if HOIST && key.ends_with(":xmlns") {
                return false;
            }
            let Some(value_tail) = trimmed[key_end + 1..].strip_prefix('"') else {
                return false;
            };
            let Some(value_end) = memchr::memchr(b'"', value_tail.as_bytes()) else {
                return false;
            };
            let (value, rest) = (&value_tail[..value_end], &value_tail[value_end + 1..]);
            if value
                .bytes()
                .any(|b| matches!(b, b'\n' | b'\t' | b'<' | b'>'))
            {
                return false;
            }
            for position in memchr::memchr_iter(b'&', value.as_bytes()) {
                let reference = &value[position + 1..];
                if ["amp;", "lt;", "gt;", "quot;"]
                    .iter()
                    .any(|entity| reference.starts_with(entity))
                    || (NORMALIZED
                        && ["#9;", "#10;", "#13;"]
                            .iter()
                            .any(|entity| reference.starts_with(entity)))
                {
                    continue;
                }
                let replacement = if HOIST {
                    [
                        ("#xA;", "&#10;"),
                        ("#xa;", "&#10;"),
                        ("#xD;", "&#13;"),
                        ("#xd;", "&#13;"),
                        ("#x9;", "&#9;"),
                    ]
                    .into_iter()
                    .find(|(entity, _)| reference.starts_with(entity))
                } else {
                    None
                };
                let Some((source, replacement)) = replacement else {
                    return false;
                };
                let start = value.as_ptr() as usize - base + position;
                self.edits
                    .push((start, start + source.len() + 1, replacement.to_owned()));
            }
            if HOIST
                && matches!(key.rsplit(':').next(), Some("Requires" | "Ignorable"))
                && value.contains("&#")
            {
                return false;
            }
            self.attributes.push(key);
            if SERIALIZED
                && matches!(key.rsplit(':').next(), Some("Requires" | "Ignorable"))
                && !value.split_whitespace().eq(value.split(' '))
            {
                self.serialized = false;
            }
            if key == "xmlns" || key.starts_with("xmlns:") {
                if SERIALIZED && !root && !HOIST {
                    self.serialized = false;
                }
                let declared = key.strip_prefix("xmlns:").unwrap_or("");
                if HOIST
                    && (value.is_empty()
                        || declared == "xmlns"
                        || value == "http://www.w3.org/2000/xmlns/")
                {
                    return false;
                }
                if (!HOIST && !root && !self.bindings.contains_key(declared))
                    || memchr::memchr(b'&', value.as_bytes()).is_some()
                {
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
                if HOIST {
                    if !self.is_bound::<HOIST>(declared) {
                        self.activations.push((depth, declared));
                        if Self::prefix_bit(declared) == 0 {
                            self.active_unknown.insert(declared);
                        }
                    }
                    self.edits.push((
                        tail.as_ptr() as usize - base,
                        rest.as_ptr() as usize - base,
                        String::new(),
                    ));
                }
                self.bindings.entry(declared).or_insert(value);
                self.bound_prefixes |= Self::prefix_bit(declared);
            }
            tail = rest;
        }
        if memchr::memchr(b':', name.as_bytes())
            .is_some_and(|position| !self.is_bound::<HOIST>(&name[..position]))
        {
            return false;
        }
        !self.attributes.iter().any(|key| {
            memchr::memchr(b':', key.as_bytes()).is_some_and(|position| {
                let prefix = &key[..position];
                prefix != "xmlns" && !self.is_bound::<HOIST>(prefix)
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
            let names = &index.named_elements[name_id].positions;
            let pos =
                names.partition_point(|id| (index.elements[*id as usize].start as usize) < start);
            *names.get(pos)? as usize
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

pub(crate) fn alternate_choices(xml: &str) -> Option<Vec<(TagRange, TagRange)>> {
    lookup(xml, |index, start, end| {
        if !index.canonical {
            return None;
        }
        let Some(alternates) = index.named("mc:AlternateContent") else {
            return None;
        };
        let choices = index.named("mc:Choice").unwrap_or(&[]);
        let first =
            alternates.partition_point(|id| (index.elements[*id as usize].start as usize) < start);
        let mut result = Vec::new();
        for (position, id) in alternates.iter().enumerate().skip(first) {
            let alternate = &index.elements[*id as usize];
            let a_start = alternate.start as usize;
            let a_end = alternate.end as usize;
            if a_start >= end {
                break;
            }
            if a_end > end
                || alternates
                    .get(position + 1)
                    .is_some_and(|id| (index.elements[*id as usize].start as usize) < a_end)
            {
                return None;
            }
            let alternate_xml = &xml[a_start - start..a_end - start];
            if !alternate_xml.starts_with("<mc:AlternateContent")
                || !alternate_xml.ends_with("</mc:AlternateContent>")
            {
                return None;
            }
            let choice_pos = choices
                .partition_point(|id| (index.elements[*id as usize].start as usize) < a_start);
            let Some(choice_id) = choices.get(choice_pos) else {
                continue;
            };
            let choice = &index.elements[*choice_id as usize];
            if choice.start as usize >= a_end {
                continue;
            }
            if choice.end as usize > a_end
                || choices
                    .get(choice_pos + 1)
                    .is_some_and(|id| index.elements[*id as usize].start < choice.end)
            {
                return None;
            }
            let choice_xml = &xml[choice.start as usize - start..choice.end as usize - start];
            if !choice_xml.starts_with("<mc:Choice")
                || !choice_xml.ends_with("</mc:Choice>")
                || choice_xml.find('>') != Some((choice.open_end - choice.start) as usize - 1)
            {
                return None;
            }
            result.push((
                TagRange {
                    start: a_start - start,
                    end: a_end - start,
                },
                TagRange {
                    start: choice.open_end as usize - start,
                    end: choice.end as usize - start - "</mc:Choice>".len(),
                },
            ));
        }
        Some(result)
    })
    .flatten()
}

pub(crate) fn ranges(xml: &str, name: &str) -> Option<Vec<TagRange>> {
    lookup(xml, |index, start, end| {
        let mut result = Vec::new();
        let Some(names) = index.named(name) else {
            return result;
        };
        let pos = names.partition_point(|id| (index.elements[*id as usize].start as usize) < start);
        let mut covered = start;
        for id in &names[pos..] {
            let element = &index.elements[*id as usize];
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
                tag_name: xml[node.name_range(&index.named_elements, start)].to_owned(),
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
                &xml[node.name_range(&index.named_elements, start)],
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

pub(crate) struct ElementRef<'a> {
    pub(crate) name: &'a str,
    pub(crate) xml: &'a str,
    pub(crate) source_start: usize,
    open_end: usize,
}

impl<'a> ElementRef<'a> {
    pub(crate) fn content(&self) -> Option<&'a str> {
        (self.open_end != self.xml.len())
            .then(|| &self.xml[self.open_end..self.xml.len() - self.name.len() - 3])
    }
}

pub(crate) fn for_each_element<'a>(
    xml: &'a str,
    mut visit: impl FnMut(ElementRef<'a>) -> bool,
) -> Option<bool> {
    lookup(xml, |index, start, end| {
        if !index.canonical {
            return None;
        }
        let root = index
            .elements
            .partition_point(|element| (element.start as usize) < start);
        let element = index.elements.get(root)?;
        if element.start as usize != start || element.end as usize != end {
            return None;
        }
        for node in &index.elements[root..element.next as usize] {
            let name_range = node.name_range(&index.named_elements, start);
            let boundary = xml.as_bytes()[name_range.end];
            if matches!(boundary, b'\x0b' | b'\x0c') {
                return None;
            }
            if !visit(ElementRef {
                name: &xml[name_range],
                xml: &xml[node.start as usize - start..node.end as usize - start],
                source_start: node.start as usize - start,
                open_end: node.open_end as usize - node.start as usize,
            }) {
                return Some(false);
            }
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
            if xml[node.name_range(&index.named_elements, start)].eq_ignore_ascii_case(name) {
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
