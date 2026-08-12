use crate::error::{AppError, Result};

pub fn infer_content_type(key: &str) -> String {
    mime_guess::from_path(key)
        .first_or_octet_stream()
        .essence_str()
        .to_string()
}

pub fn validate_content_type(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::ConfigError(
            "Content-Type cannot be empty".to_string(),
        ));
    }
    if value.len() > 255 {
        return Err(AppError::ConfigError(
            "Content-Type cannot exceed 255 characters".to_string(),
        ));
    }

    let parsed = value.parse::<mime::Mime>().map_err(|_| {
        AppError::ConfigError(format!(
            "Invalid Content-Type '{}'. Use a media type such as text/html or application/json.",
            value
        ))
    })?;

    if parsed.type_() == mime::STAR || parsed.subtype() == mime::STAR {
        return Err(AppError::ConfigError(
            "Content-Type cannot contain a wildcard".to_string(),
        ));
    }

    Ok(parsed.to_string())
}

#[cfg(test)]
mod tests {
    use super::{infer_content_type, validate_content_type};

    #[test]
    fn common_web_files_get_browser_compatible_content_types() {
        assert_eq!(infer_content_type("site/index.html"), "text/html");
        assert_eq!(infer_content_type("assets/styles.css"), "text/css");
        assert_eq!(infer_content_type("data/report.json"), "application/json");
        assert_eq!(
            infer_content_type("unknown.custom-extension"),
            "application/octet-stream"
        );
    }

    #[test]
    fn custom_content_types_are_parsed_and_validated() {
        assert_eq!(
            validate_content_type(" text/html; charset=utf-8 ").unwrap(),
            "text/html; charset=utf-8"
        );
        assert!(validate_content_type("not a media type").is_err());
        assert!(validate_content_type("text/*").is_err());
        assert!(validate_content_type("").is_err());
    }
}
