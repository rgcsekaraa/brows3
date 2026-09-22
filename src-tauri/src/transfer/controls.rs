use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub fn validate_bandwidth(rate: u64) -> Result<()> {
    if rate != 0 && !(64 * 1024..=1024 * 1024 * 1024).contains(&rate) {
        return Err(AppError::ConfigError(
            "Bandwidth must be unlimited (0), or 64 to 1,048,576 KiB/s per transfer.".into(),
        ));
    }
    Ok(())
}

pub fn delay(bytes: u64, rate: u64) -> Duration {
    if rate == 0 {
        Duration::ZERO
    } else {
        Duration::from_secs_f64(bytes as f64 / rate as f64)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct SyncOptions {
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub skip_existing: bool,
}

pub struct Filters {
    include: Vec<glob::Pattern>,
    exclude: Vec<glob::Pattern>,
}
impl Filters {
    pub fn new(options: &SyncOptions) -> Result<Self> {
        if options.include.len() + options.exclude.len() > 100 {
            return Err(AppError::ConfigError(
                "Use at most 100 filter patterns.".into(),
            ));
        }
        fn compile(patterns: &[String]) -> Result<Vec<glob::Pattern>> {
            patterns.iter().map(|pattern| {
                if pattern.is_empty() || pattern.len() > 1024 || pattern.starts_with('/') || pattern.contains('\\') || pattern.chars().any(char::is_control) {
                    return Err(AppError::ConfigError("Patterns must be relative paths of 1 to 1,024 bytes, using forward slashes.".into()));
                }
                glob::Pattern::new(pattern).map_err(|e| AppError::ConfigError(format!("Invalid filter {pattern:?}: {e}")))
            }).collect()
        }
        Ok(Self {
            include: compile(&options.include)?,
            exclude: compile(&options.exclude)?,
        })
    }
    pub fn accepts(&self, path: &str) -> bool {
        let opts = glob::MatchOptions {
            case_sensitive: true,
            require_literal_separator: true,
            require_literal_leading_dot: false,
        };
        (self.include.is_empty() || self.include.iter().any(|p| p.matches_with(path, opts)))
            && !self.exclude.iter().any(|p| p.matches_with(path, opts))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filters_are_relative_case_sensitive_and_exclusions_win() {
        let f = Filters::new(&SyncOptions {
            include: vec!["**/*.txt".into()],
            exclude: vec!["private/**".into()],
            skip_existing: true,
        })
        .unwrap();
        for key in ["file.txt", "a/file.txt", ".hidden.txt", "space name.txt"] {
            assert!(f.accepts(key), "{key}");
        }
        for key in [
            "FILE.TXT",
            "file.jpg",
            "private/file.txt",
            "private/a/file.txt",
        ] {
            assert!(!f.accepts(key), "{key}");
        }
        assert!(!Filters::new(&SyncOptions {
            include: vec!["*.txt".into()],
            ..Default::default()
        })
        .unwrap()
        .accepts("a/file.txt"));
        assert!(Filters::new(&SyncOptions::default())
            .unwrap()
            .accepts("a/file"));
    }
    #[test]
    fn invalid_patterns_and_rates_are_rejected() {
        for pattern in ["", "[", "**bad", "/absolute", "a\\b", "line\nbreak"] {
            assert!(Filters::new(&SyncOptions {
                include: vec![pattern.into()],
                ..Default::default()
            })
            .is_err());
        }
        assert!(Filters::new(&SyncOptions {
            include: vec!["*".into(); 101],
            ..Default::default()
        })
        .is_err());
        for rate in [0, 65536, 1073741824] {
            assert!(validate_bandwidth(rate).is_ok());
        }
        for rate in [1, 65535, 1073741825, u64::MAX] {
            assert!(validate_bandwidth(rate).is_err());
        }
        assert_eq!(delay(65536, 65536), Duration::from_secs(1));
        assert_eq!(delay(65536, 0), Duration::ZERO);
    }
}
