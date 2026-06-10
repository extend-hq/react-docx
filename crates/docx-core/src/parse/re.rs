use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use regex_lite::Regex;

static REGEX_CACHE: LazyLock<Mutex<HashMap<String, &'static Regex>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn get(pattern: &str) -> Option<&'static Regex> {
    if let Ok(cache) = REGEX_CACHE.lock() {
        if let Some(regex) = cache.get(pattern) {
            return Some(regex);
        }
    }

    let compiled = Regex::new(pattern).ok()?;
    let leaked: &'static Regex = Box::leak(Box::new(compiled));
    if let Ok(mut cache) = REGEX_CACHE.lock() {
        cache.insert(pattern.to_string(), leaked);
    }
    Some(leaked)
}

pub fn get_unchecked(pattern: &str) -> &'static Regex {
    get(pattern).unwrap_or_else(|| panic!("invalid regex pattern: {pattern}"))
}
