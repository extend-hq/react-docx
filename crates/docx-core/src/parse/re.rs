use std::collections::HashMap;
use std::sync::LazyLock;
#[cfg(target_arch = "wasm32")]
use std::sync::Mutex;

use regex::Regex;

#[cfg(target_arch = "wasm32")]
static REGEX_CACHE: LazyLock<Mutex<HashMap<String, &'static Regex>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn ascii_token_pattern(pattern: &str) -> String {
    let mut result = String::with_capacity(pattern.len());
    let mut chars = pattern.chars();
    let mut class_depth = 0usize;
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            let Some(escaped) = chars.next() else {
                result.push(ch);
                break;
            };
            let replacement = match escaped {
                'b' if class_depth == 0 => Some(r"(?-u:\b)"),
                'B' if class_depth == 0 => Some(r"(?-u:\B)"),
                'd' => Some("[0-9]"),
                'D' => Some("[^0-9]"),
                's' => Some(r"[\x09-\x0D\x20]"),
                'S' => Some(r"[^\x09-\x0D\x20]"),
                'w' => Some("[0-9A-Za-z_]"),
                'W' => Some("[^0-9A-Za-z_]"),
                _ => None,
            };
            if let Some(replacement) = replacement {
                result.push_str(replacement);
            } else {
                result.push(ch);
                result.push(escaped);
            }
        } else {
            if ch == '[' {
                class_depth += 1;
            }
            if ch == ']' {
                class_depth = class_depth.saturating_sub(1);
            }
            result.push(ch);
        }
    }
    result
}

#[cfg(not(target_arch = "wasm32"))]
static REGEX_CACHE: LazyLock<super::cache::Snapshot<HashMap<String, &'static Regex>>> =
    LazyLock::new(|| super::cache::Snapshot::new(HashMap::new()));

#[cfg(not(target_arch = "wasm32"))]
thread_local! {
    static REGEX_READER: std::cell::RefCell<arc_swap::cache::Cache<
        &'static arc_swap::ArcSwap<HashMap<String, &'static Regex>>,
        std::sync::Arc<HashMap<String, &'static Regex>>,
    >> = std::cell::RefCell::new(REGEX_CACHE.reader());
}

pub fn get(pattern: &str) -> Option<&'static Regex> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        if let Some(regex) =
            REGEX_READER.with(|cache| cache.borrow_mut().load().get(pattern).copied())
        {
            return Some(regex);
        }
        let compiled = Regex::new(&ascii_token_pattern(pattern)).ok()?;
        let key = pattern.to_owned();
        let result = REGEX_CACHE.update(move |cache| {
            let mut next = cache.clone();
            let regex = *next
                .entry(key)
                .or_insert_with(|| Box::leak(Box::new(compiled)));
            (next, regex)
        });
        result.or_else(|| {
            Regex::new(&ascii_token_pattern(pattern))
                .ok()
                .map(|regex| &*Box::leak(Box::new(regex)))
        })
    }
    #[cfg(target_arch = "wasm32")]
    {
        if let Ok(cache) = REGEX_CACHE.lock() {
            if let Some(regex) = cache.get(pattern) {
                return Some(regex);
            }
        }
        let compiled = Regex::new(&ascii_token_pattern(pattern)).ok()?;
        let leaked: &'static Regex = Box::leak(Box::new(compiled));
        if let Ok(mut cache) = REGEX_CACHE.lock() {
            cache.insert(pattern.to_string(), leaked);
        }
        Some(leaked)
    }
}

pub fn get_unchecked(pattern: &str) -> &'static Regex {
    get(pattern).unwrap_or_else(|| panic!("invalid regex pattern: {pattern}"))
}
