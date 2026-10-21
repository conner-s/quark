use serde::{Deserialize, Serialize};
use std::path::Path;

/// Root theme structure parsed from a TOML theme file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Theme {
    pub meta: ThemeMeta,
    pub colors: ThemeColors,
    pub typography: ThemeTypography,
    pub borders: ThemeBorders,
    pub emoji: ThemeEmoji,
    pub prompt: ThemePrompt,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeMeta {
    pub name: String,
    pub author: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeColors {
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub selection_bg: String,
    pub selection_fg: String,
    pub border: String,
    pub accent: ThemeAccentColors,
    pub messages: ThemeMessageColors,
    pub roomlist: ThemeRoomlistColors,
    pub reactions: ThemeReactionColors,
    /// `[colors.syntax]`: code block surface and token colours. Optional where
    /// every other table is required, because it arrived after themes already
    /// existed: one without it gets defaults derived from its palette (vars.css)
    /// and must keep parsing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub syntax: Option<ThemeSyntaxColors>,
}

/// Code block colours. `background` / `foreground` / `border` style the block
/// itself, every other key one highlight.js token class. Each is optional — a
/// key left out falls back to its vars.css default — and the keys are flat, as
/// `src/theme/loader.ts` reads them.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ThemeSyntaxColors {
    pub background: Option<String>,
    pub foreground: Option<String>,
    pub border: Option<String>,
    pub comment: Option<String>,
    pub keyword: Option<String>,
    pub string: Option<String>,
    pub number: Option<String>,
    pub constant: Option<String>,
    pub builtin: Option<String>,
    pub r#type: Option<String>,
    pub function: Option<String>,
    pub variable: Option<String>,
    pub attribute: Option<String>,
    pub tag: Option<String>,
    pub operator: Option<String>,
    pub punctuation: Option<String>,
    pub escape: Option<String>,
    pub meta: Option<String>,
    pub regexp: Option<String>,
    pub section: Option<String>,
    pub addition: Option<String>,
    pub deletion: Option<String>,
}

impl ThemeSyntaxColors {
    /// Every key with its value, in schema order. `self` is destructured
    /// without `..`, so a field added without an entry here fails to compile
    /// rather than slipping past validation.
    pub fn entries(&self) -> [(&'static str, Option<&str>); 22] {
        let Self {
            background,
            foreground,
            border,
            comment,
            keyword,
            string,
            number,
            constant,
            builtin,
            r#type,
            function,
            variable,
            attribute,
            tag,
            operator,
            punctuation,
            escape,
            meta,
            regexp,
            section,
            addition,
            deletion,
        } = self;
        [
            ("background", background.as_deref()),
            ("foreground", foreground.as_deref()),
            ("border", border.as_deref()),
            ("comment", comment.as_deref()),
            ("keyword", keyword.as_deref()),
            ("string", string.as_deref()),
            ("number", number.as_deref()),
            ("constant", constant.as_deref()),
            ("builtin", builtin.as_deref()),
            ("type", r#type.as_deref()),
            ("function", function.as_deref()),
            ("variable", variable.as_deref()),
            ("attribute", attribute.as_deref()),
            ("tag", tag.as_deref()),
            ("operator", operator.as_deref()),
            ("punctuation", punctuation.as_deref()),
            ("escape", escape.as_deref()),
            ("meta", meta.as_deref()),
            ("regexp", regexp.as_deref()),
            ("section", section.as_deref()),
            ("addition", addition.as_deref()),
            ("deletion", deletion.as_deref()),
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeAccentColors {
    pub primary: String,
    pub secondary: String,
    pub error: String,
    pub warning: String,
    pub success: String,
    pub link: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeMessageColors {
    pub own: String,
    pub other: String,
    pub system: String,
    pub timestamp: String,
    pub mention_bg: String,
    pub mention_fg: String,
    pub reply_border: String,
    pub thread_indicator: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeRoomlistColors {
    pub active_bg: String,
    pub active_fg: String,
    pub unread: String,
    pub mention_badge: String,
    pub muted: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeReactionColors {
    pub background: String,
    pub border: String,
    pub own_bg: String,
    pub count: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeTypography {
    pub font_family: String,
    pub font_size: u32,
    pub line_height: f32,
    pub message_spacing: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeBorders {
    pub style: BorderStyle,
    pub room_list_width: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BorderStyle {
    Single,
    Double,
    Rounded,
    Ascii,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeEmoji {
    pub size: u32,
    pub sticker_max_size: u32,
    pub reaction_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemePrompt {
    pub symbol: String,
    pub normal_indicator: String,
    pub insert_indicator: String,
    pub command_indicator: String,
    pub visual_indicator: String,
}

/// Validation errors for a theme.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeValidationError {
    pub field: String,
    pub message: String,
}

/// Parse a theme from a TOML string.
pub fn parse_theme(toml_content: &str) -> Result<Theme, String> {
    let theme: Theme = toml::from_str(toml_content)
        .map_err(|e| format!("Failed to parse theme TOML: {e}"))?;
    Ok(theme)
}

/// Load and parse a theme from a file path.
pub fn load_theme_file(path: &Path) -> Result<Theme, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read theme file '{}': {e}", path.display()))?;
    parse_theme(&content)
}

/// Validate that a color string is a valid hex color (#rrggbb or #rgb).
fn is_valid_hex_color(color: &str) -> bool {
    if !color.starts_with('#') {
        return false;
    }
    let hex = &color[1..];
    matches!(hex.len(), 3 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit())
}

/// Validate all color fields in a theme. Returns a list of errors.
pub fn validate_theme(theme: &Theme) -> Vec<ThemeValidationError> {
    let mut errors = Vec::new();

    macro_rules! check_color {
        ($field:expr, $value:expr) => {
            if !is_valid_hex_color($value) {
                errors.push(ThemeValidationError {
                    field: $field.to_string(),
                    message: format!("'{}' is not a valid hex color", $value),
                });
            }
        };
    }

    check_color!("colors.background", &theme.colors.background);
    check_color!("colors.foreground", &theme.colors.foreground);
    check_color!("colors.cursor", &theme.colors.cursor);
    check_color!("colors.selection_bg", &theme.colors.selection_bg);
    check_color!("colors.selection_fg", &theme.colors.selection_fg);
    check_color!("colors.border", &theme.colors.border);

    check_color!("colors.accent.primary", &theme.colors.accent.primary);
    check_color!("colors.accent.secondary", &theme.colors.accent.secondary);
    check_color!("colors.accent.error", &theme.colors.accent.error);
    check_color!("colors.accent.warning", &theme.colors.accent.warning);
    check_color!("colors.accent.success", &theme.colors.accent.success);
    check_color!("colors.accent.link", &theme.colors.accent.link);

    check_color!("colors.messages.own", &theme.colors.messages.own);
    check_color!("colors.messages.other", &theme.colors.messages.other);
    check_color!("colors.messages.system", &theme.colors.messages.system);
    check_color!("colors.messages.timestamp", &theme.colors.messages.timestamp);
    check_color!("colors.messages.mention_bg", &theme.colors.messages.mention_bg);
    check_color!("colors.messages.mention_fg", &theme.colors.messages.mention_fg);
    check_color!("colors.messages.reply_border", &theme.colors.messages.reply_border);
    check_color!(
        "colors.messages.thread_indicator",
        &theme.colors.messages.thread_indicator
    );

    check_color!("colors.roomlist.active_bg", &theme.colors.roomlist.active_bg);
    check_color!("colors.roomlist.active_fg", &theme.colors.roomlist.active_fg);
    check_color!("colors.roomlist.unread", &theme.colors.roomlist.unread);
    check_color!(
        "colors.roomlist.mention_badge",
        &theme.colors.roomlist.mention_badge
    );
    check_color!("colors.roomlist.muted", &theme.colors.roomlist.muted);

    check_color!("colors.reactions.background", &theme.colors.reactions.background);
    check_color!("colors.reactions.border", &theme.colors.reactions.border);
    check_color!("colors.reactions.own_bg", &theme.colors.reactions.own_bg);
    check_color!("colors.reactions.count", &theme.colors.reactions.count);

    // Syntax keys are optional, so only the ones a theme sets are checked.
    if let Some(syntax) = &theme.colors.syntax {
        for (key, value) in syntax.entries() {
            if let Some(value) = value {
                check_color!(format!("colors.syntax.{key}"), value);
            }
        }
    }

    // Validate font size
    if theme.typography.font_size < 6 || theme.typography.font_size > 72 {
        errors.push(ThemeValidationError {
            field: "typography.font_size".to_string(),
            message: format!(
                "font_size {} is out of range (6–72)",
                theme.typography.font_size
            ),
        });
    }

    // Validate emoji sizes
    if theme.emoji.size < 8 || theme.emoji.size > 256 {
        errors.push(ThemeValidationError {
            field: "emoji.size".to_string(),
            message: format!("emoji.size {} is out of range (8–256)", theme.emoji.size),
        });
    }

    errors
}

/// Return the default Phosphor theme.
pub fn default_theme() -> Theme {
    let hex = |s: &str| Some(s.to_string());
    Theme {
        meta: ThemeMeta {
            name: "Phosphor".to_string(),
            author: Some("Quark".to_string()),
            version: Some("1.0".to_string()),
        },
        colors: ThemeColors {
            background: "#0a0a0a".to_string(),
            foreground: "#b0b0b0".to_string(),
            cursor: "#00ff41".to_string(),
            selection_bg: "#1a3a1a".to_string(),
            selection_fg: "#00ff41".to_string(),
            border: "#333333".to_string(),
            accent: ThemeAccentColors {
                primary: "#00ff41".to_string(),
                secondary: "#00aaff".to_string(),
                error: "#ff3333".to_string(),
                warning: "#ffaa00".to_string(),
                success: "#00ff41".to_string(),
                link: "#00aaff".to_string(),
            },
            messages: ThemeMessageColors {
                own: "#00ff41".to_string(),
                other: "#b0b0b0".to_string(),
                system: "#555555".to_string(),
                timestamp: "#444444".to_string(),
                mention_bg: "#1a1a00".to_string(),
                mention_fg: "#ffaa00".to_string(),
                reply_border: "#555555".to_string(),
                thread_indicator: "#00aaff".to_string(),
            },
            roomlist: ThemeRoomlistColors {
                active_bg: "#1a1a1a".to_string(),
                active_fg: "#00ff41".to_string(),
                unread: "#ffffff".to_string(),
                mention_badge: "#ff3333".to_string(),
                muted: "#444444".to_string(),
            },
            reactions: ThemeReactionColors {
                background: "#1a1a1a".to_string(),
                border: "#333333".to_string(),
                own_bg: "#1a3a1a".to_string(),
                count: "#888888".to_string(),
            },
            // themes/phosphor.toml's table; a test pins the two together.
            syntax: Some(ThemeSyntaxColors {
                background: hex("#0c130c"),
                foreground: hex("#b0b0b0"),
                border: hex("#1a3a1a"),
                comment: hex("#4e8a5c"),
                keyword: hex("#00ff41"),
                string: hex("#a6ffbc"),
                number: hex("#ffaa00"),
                constant: hex("#ffaa00"),
                builtin: hex("#00c435"),
                r#type: hex("#6dff93"),
                function: hex("#d4ffe0"),
                variable: hex("#b0b0b0"),
                attribute: hex("#6dff93"),
                tag: hex("#00ff41"),
                operator: hex("#86c693"),
                punctuation: hex("#6f8f76"),
                escape: hex("#ffaa00"),
                meta: hex("#00aaff"),
                regexp: hex("#a6ffbc"),
                section: hex("#00ff41"),
                addition: hex("#00ff41"),
                deletion: hex("#ff3333"),
            }),
        },
        typography: ThemeTypography {
            font_family: "JetBrains Mono, Fira Code, monospace".to_string(),
            font_size: 14,
            line_height: 1.5,
            message_spacing: 4,
        },
        borders: ThemeBorders {
            style: BorderStyle::Single,
            room_list_width: "25%".to_string(),
        },
        emoji: ThemeEmoji {
            size: 32,
            sticker_max_size: 256,
            reaction_size: 20,
        },
        prompt: ThemePrompt {
            symbol: ":>".to_string(),
            normal_indicator: "NOR".to_string(),
            insert_indicator: "INS".to_string(),
            command_indicator: "CMD".to_string(),
            visual_indicator: "VIS".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHOSPHOR_TOML: &str = r##"
[meta]
name = "Phosphor"
author = "user"
version = "1.0"

[colors]
background = "#0a0a0a"
foreground = "#b0b0b0"
cursor = "#00ff41"
selection_bg = "#1a3a1a"
selection_fg = "#00ff41"
border = "#333333"

[colors.accent]
primary = "#00ff41"
secondary = "#00aaff"
error = "#ff3333"
warning = "#ffaa00"
success = "#00ff41"
link = "#00aaff"

[colors.messages]
own = "#00ff41"
other = "#b0b0b0"
system = "#555555"
timestamp = "#444444"
mention_bg = "#1a1a00"
mention_fg = "#ffaa00"
reply_border = "#555555"
thread_indicator = "#00aaff"

[colors.roomlist]
active_bg = "#1a1a1a"
active_fg = "#00ff41"
unread = "#ffffff"
mention_badge = "#ff3333"
muted = "#444444"

[colors.reactions]
background = "#1a1a1a"
border = "#333333"
own_bg = "#1a3a1a"
count = "#888888"

[typography]
font_family = "JetBrains Mono, Fira Code, monospace"
font_size = 14
line_height = 1.5
message_spacing = 4

[borders]
style = "single"
room_list_width = "25%"

[emoji]
size = 32
sticker_max_size = 256
reaction_size = 20

[prompt]
symbol = ":>"
normal_indicator = "NOR"
insert_indicator = "INS"
command_indicator = "CMD"
visual_indicator = "VIS"
"##;

    #[test]
    fn test_parse_phosphor_theme() {
        let theme = parse_theme(PHOSPHOR_TOML).expect("Should parse valid theme");
        assert_eq!(theme.meta.name, "Phosphor");
        assert_eq!(theme.colors.background, "#0a0a0a");
        assert_eq!(theme.colors.cursor, "#00ff41");
        assert_eq!(theme.colors.accent.primary, "#00ff41");
        assert_eq!(theme.colors.messages.own, "#00ff41");
        assert_eq!(theme.colors.roomlist.unread, "#ffffff");
        assert_eq!(theme.colors.reactions.count, "#888888");
        assert_eq!(theme.typography.font_size, 14);
        assert!((theme.typography.line_height - 1.5).abs() < f32::EPSILON);
        assert_eq!(theme.borders.style, BorderStyle::Single);
        assert_eq!(theme.emoji.size, 32);
        assert_eq!(theme.prompt.symbol, ":>");
    }

    #[test]
    fn test_theme_validation_passes_for_valid_theme() {
        let theme = parse_theme(PHOSPHOR_TOML).unwrap();
        let errors = validate_theme(&theme);
        assert!(errors.is_empty(), "Valid theme should have no errors: {:?}", errors);
    }

    #[test]
    fn test_theme_validation_fails_for_bad_color() {
        let mut theme = parse_theme(PHOSPHOR_TOML).unwrap();
        theme.colors.background = "not-a-color".to_string();
        let errors = validate_theme(&theme);
        assert!(
            errors.iter().any(|e| e.field == "colors.background"),
            "Should report bad color error"
        );
    }

    #[test]
    fn test_default_theme_is_valid() {
        let theme = default_theme();
        let errors = validate_theme(&theme);
        assert!(errors.is_empty(), "Default theme should be valid: {:?}", errors);
    }

    #[test]
    fn test_hex_color_validation() {
        assert!(is_valid_hex_color("#ff3333"));
        assert!(is_valid_hex_color("#fff"));
        assert!(is_valid_hex_color("#00ff4180")); // with alpha
        assert!(!is_valid_hex_color("ff3333")); // missing #
        assert!(!is_valid_hex_color("#gg1234")); // invalid hex
        assert!(!is_valid_hex_color("#12345")); // wrong length
    }

    #[test]
    fn test_parse_invalid_toml_returns_error() {
        let result = parse_theme("this is not valid toml [[[[");
        assert!(result.is_err());
    }

    #[test]
    fn test_border_style_deserialization() {
        let toml = PHOSPHOR_TOML.replace(r#"style = "single""#, r#"style = "double""#);
        let theme = parse_theme(&toml).unwrap();
        assert_eq!(theme.borders.style, BorderStyle::Double);
    }

    // --- All BorderStyle variants deserialize ---

    #[test]
    fn test_border_style_rounded() {
        let toml = PHOSPHOR_TOML.replace(r#"style = "single""#, r#"style = "rounded""#);
        let theme = parse_theme(&toml).unwrap();
        assert_eq!(theme.borders.style, BorderStyle::Rounded);
    }

    #[test]
    fn test_border_style_ascii() {
        let toml = PHOSPHOR_TOML.replace(r#"style = "single""#, r#"style = "ascii""#);
        let theme = parse_theme(&toml).unwrap();
        assert_eq!(theme.borders.style, BorderStyle::Ascii);
    }

    #[test]
    fn test_border_style_none() {
        let toml = PHOSPHOR_TOML.replace(r#"style = "single""#, r#"style = "none""#);
        let theme = parse_theme(&toml).unwrap();
        assert_eq!(theme.borders.style, BorderStyle::None);
    }

    // --- Invalid hex colors ---

    #[test]
    fn test_hex_color_missing_hash() {
        assert!(!is_valid_hex_color("ff3333"));
        assert!(!is_valid_hex_color("00ff41"));
    }

    #[test]
    fn test_hex_color_wrong_length() {
        assert!(!is_valid_hex_color("#12345")); // 5 hex digits
        assert!(!is_valid_hex_color("#1234567")); // 7 hex digits
        assert!(!is_valid_hex_color("#")); // empty hex part
    }

    #[test]
    fn test_hex_color_invalid_characters() {
        assert!(!is_valid_hex_color("#gg1234"));
        assert!(!is_valid_hex_color("#xyz000"));
        assert!(!is_valid_hex_color("#00ff4g"));
    }

    #[test]
    fn test_hex_color_short_form_valid() {
        assert!(is_valid_hex_color("#abc"));
        assert!(is_valid_hex_color("#000"));
        assert!(is_valid_hex_color("#fff"));
    }

    #[test]
    fn test_hex_color_with_alpha_valid() {
        assert!(is_valid_hex_color("#00ff4180"));
        assert!(is_valid_hex_color("#00000000"));
        assert!(is_valid_hex_color("#ffffffff"));
    }

    // --- Validation catches out-of-range font_size ---

    #[test]
    fn test_font_size_too_small_triggers_error() {
        let mut theme = default_theme();
        theme.typography.font_size = 4; // below min of 6
        let errors = validate_theme(&theme);
        assert!(
            errors.iter().any(|e| e.field == "typography.font_size"),
            "Should flag font_size < 6"
        );
    }

    #[test]
    fn test_font_size_too_large_triggers_error() {
        let mut theme = default_theme();
        theme.typography.font_size = 100; // above max of 72
        let errors = validate_theme(&theme);
        assert!(
            errors.iter().any(|e| e.field == "typography.font_size"),
            "Should flag font_size > 72"
        );
    }

    #[test]
    fn test_font_size_boundary_values_are_valid() {
        let mut theme = default_theme();
        theme.typography.font_size = 6;
        assert!(validate_theme(&theme).is_empty());
        theme.typography.font_size = 72;
        assert!(validate_theme(&theme).is_empty());
    }

    // --- Validation catches out-of-range emoji size ---

    #[test]
    fn test_emoji_size_too_small_triggers_error() {
        let mut theme = default_theme();
        theme.emoji.size = 4; // below min of 8
        let errors = validate_theme(&theme);
        assert!(
            errors.iter().any(|e| e.field == "emoji.size"),
            "Should flag emoji.size < 8"
        );
    }

    #[test]
    fn test_emoji_size_too_large_triggers_error() {
        let mut theme = default_theme();
        theme.emoji.size = 512; // above max of 256
        let errors = validate_theme(&theme);
        assert!(
            errors.iter().any(|e| e.field == "emoji.size"),
            "Should flag emoji.size > 256"
        );
    }

    #[test]
    fn test_emoji_size_boundary_values_are_valid() {
        let mut theme = default_theme();
        theme.emoji.size = 8;
        assert!(validate_theme(&theme).is_empty());
        theme.emoji.size = 256;
        assert!(validate_theme(&theme).is_empty());
    }

    // --- Missing required sections fail to parse ---

    #[test]
    fn test_missing_meta_section_fails() {
        let toml = r##"
[colors]
background = "#0a0a0a"
foreground = "#b0b0b0"
"##;
        assert!(parse_theme(toml).is_err());
    }

    #[test]
    fn test_missing_colors_section_fails() {
        let toml = r#"
[meta]
name = "Test"
"#;
        assert!(parse_theme(toml).is_err());
    }

    #[test]
    fn test_empty_toml_fails() {
        assert!(parse_theme("").is_err());
    }

    // --- Default values ---

    #[test]
    fn test_default_theme_name_is_phosphor() {
        let theme = default_theme();
        assert_eq!(theme.meta.name, "Phosphor");
    }

    #[test]
    fn test_default_theme_has_author() {
        let theme = default_theme();
        assert!(theme.meta.author.is_some());
    }

    #[test]
    fn test_default_theme_font_size_in_range() {
        let theme = default_theme();
        assert!(theme.typography.font_size >= 6);
        assert!(theme.typography.font_size <= 72);
    }

    #[test]
    fn test_default_theme_emoji_size_in_range() {
        let theme = default_theme();
        assert!(theme.emoji.size >= 8);
        assert!(theme.emoji.size <= 256);
    }

    #[test]
    fn test_default_theme_border_style_is_single() {
        let theme = default_theme();
        assert_eq!(theme.borders.style, BorderStyle::Single);
    }

    #[test]
    fn test_default_theme_prompt_has_all_indicators() {
        let theme = default_theme();
        assert!(!theme.prompt.symbol.is_empty());
        assert!(!theme.prompt.normal_indicator.is_empty());
        assert!(!theme.prompt.insert_indicator.is_empty());
        assert!(!theme.prompt.command_indicator.is_empty());
        assert!(!theme.prompt.visual_indicator.is_empty());
    }

    // --- validate_theme reports correct field names ---

    #[test]
    fn test_validation_reports_correct_field_for_bad_accent_primary() {
        let mut theme = default_theme();
        theme.colors.accent.primary = "notacolor".to_string();
        let errors = validate_theme(&theme);
        assert!(errors.iter().any(|e| e.field == "colors.accent.primary"));
    }

    #[test]
    fn test_validation_reports_correct_field_for_bad_roomlist_unread() {
        let mut theme = default_theme();
        theme.colors.roomlist.unread = "bad".to_string();
        let errors = validate_theme(&theme);
        assert!(errors.iter().any(|e| e.field == "colors.roomlist.unread"));
    }

    #[test]
    fn test_validation_error_message_contains_invalid_value() {
        let mut theme = default_theme();
        theme.colors.background = "notacolor".to_string();
        let errors = validate_theme(&theme);
        let bg_error = errors.iter().find(|e| e.field == "colors.background").unwrap();
        assert!(bg_error.message.contains("notacolor"));
    }

    // --- [colors.syntax] ---

    /// A partial table, appended to PHOSPHOR_TOML: TOML allows a sub-table
    /// header after unrelated tables, and a partial table is the common case.
    const SYNTAX_TABLE: &str = r##"
[colors.syntax]
background = "#0c130c"
keyword = "#00ff41"
type = "#6dff93"
"##;

    /// The theme files the app ships, as plain TOML values rather than through
    /// `parse_theme`: pesterchum's `style = "square"` border is no BorderStyle
    /// this struct knows, which is beside the point of what reads these.
    fn bundled_themes() -> Vec<(String, toml::Value)> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../themes");
        let entries = std::fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("reading {}: {e}", dir.display()));
        let mut themes: Vec<(String, toml::Value)> = entries
            .map(|entry| entry.expect("theme dir entry").path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "toml"))
            .map(|path| {
                let src = std::fs::read_to_string(&path).expect("theme file readable");
                let value = toml::from_str(&src)
                    .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
                (path.file_name().unwrap().to_string_lossy().into_owned(), value)
            })
            .collect();
        themes.sort_by(|a, b| a.0.cmp(&b.0));
        themes
    }

    #[test]
    fn test_theme_without_syntax_table_still_parses() {
        let theme = parse_theme(PHOSPHOR_TOML).expect("a theme predating [colors.syntax] must parse");
        assert_eq!(theme.colors.syntax, None);
        assert!(validate_theme(&theme).is_empty());
    }

    #[test]
    fn test_syntax_table_parses_and_round_trips() {
        let theme = parse_theme(&format!("{PHOSPHOR_TOML}{SYNTAX_TABLE}")).unwrap();
        let syntax = theme.colors.syntax.as_ref().expect("[colors.syntax] parsed");
        assert_eq!(syntax.background.as_deref(), Some("#0c130c"));
        assert_eq!(syntax.keyword.as_deref(), Some("#00ff41"));
        assert_eq!(syntax.r#type.as_deref(), Some("#6dff93"));
        assert_eq!(syntax.string, None, "a key left out stays unset");

        let serialized = toml::to_string(&theme).expect("theme serializes");
        assert_eq!(parse_theme(&serialized).unwrap(), theme);
    }

    #[test]
    fn test_invalid_syntax_colour_is_reported() {
        let mut theme = default_theme();
        theme.colors.syntax.as_mut().unwrap().keyword = Some("purple".to_string());
        let errors = validate_theme(&theme);
        assert_eq!(errors.len(), 1, "only the bad key is flagged: {errors:?}");
        assert_eq!(errors[0].field, "colors.syntax.keyword");
        assert!(errors[0].message.contains("purple"));
    }

    // entries() spells each key by hand. One misspelt there would validate the
    // field under a name no theme file uses, so feed its keys back through serde.
    #[test]
    fn test_syntax_entries_name_every_serde_key() {
        let keys = ThemeSyntaxColors::default().entries().map(|(key, _)| key);
        let table: toml::Table = keys
            .iter()
            .map(|key| (key.to_string(), toml::Value::String("#000".to_string())))
            .collect();
        let syntax: ThemeSyntaxColors = toml::Value::Table(table).try_into().unwrap();
        for (key, value) in syntax.entries() {
            assert!(value.is_some(), "entries() key '{key}' matches no serde field");
        }
    }

    #[test]
    fn test_bundled_syntax_tables_use_known_keys_and_hex_colours() {
        let known = ThemeSyntaxColors::default().entries().map(|(key, _)| key);
        let themes = bundled_themes();
        assert!(
            themes.iter().any(|(name, _)| name == "phosphor.toml"),
            "theme files not found"
        );
        let mut with_table = 0;
        for (name, theme) in &themes {
            let Some(syntax) = theme.get("colors").and_then(|c| c.get("syntax")) else {
                continue;
            };
            let table = syntax
                .as_table()
                .unwrap_or_else(|| panic!("{name}: [colors.syntax] is not a table"));
            with_table += 1;
            for (key, value) in table {
                assert!(known.contains(&key.as_str()), "{name}: unknown [colors.syntax] key '{key}'");
                let colour = value
                    .as_str()
                    .unwrap_or_else(|| panic!("{name}: colors.syntax.{key} is not a string"));
                assert!(
                    is_valid_hex_color(colour),
                    "{name}: colors.syntax.{key} = '{colour}' is not a hex colour"
                );
            }
        }
        assert!(with_table > 0, "no bundled theme has a [colors.syntax] table");
    }

    #[test]
    fn test_default_theme_syntax_matches_phosphor_toml() {
        let (_, phosphor) = bundled_themes()
            .into_iter()
            .find(|(name, _)| name == "phosphor.toml")
            .expect("themes/phosphor.toml");
        let syntax: ThemeSyntaxColors = phosphor["colors"]["syntax"].clone().try_into().unwrap();
        assert_eq!(default_theme().colors.syntax, Some(syntax));
    }
}
