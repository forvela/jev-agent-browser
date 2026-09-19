## ADDED Requirements

### Requirement: Accept a generic classification profile
The system MUST accept profile-defined dimensions with instructions and bounded named choices. A profile MAY declare `evidenceFields` whose bounded values are added to the classification projection after configured follow-ups.

#### Scenario: LinkedIn profile
- **WHEN** a profile describes hiring signal, geography, role fit, source quality, and keep rules
- **THEN** the classifier uses those dimensions without containing LinkedIn-specific logic

#### Scenario: Non-LinkedIn profile
- **WHEN** a profile describes products, documents, or another evidence domain
- **THEN** the same classifier accepts it without code changes

#### Scenario: Source and author intent
- **WHEN** a profile defines dimensions for source type, actor type, or post intent
- **THEN** the classifier returns those labels without hard-coded domain categories

#### Scenario: Detail evidence
- **WHEN** a configured follow-up adds a bounded detail object to an item and the profile names its field in `evidenceFields`
- **THEN** the classifier receives that detail evidence after sensitive-value redaction

#### Scenario: Profile-owned policy override
- **WHEN** a profile declares a regex override against a configured evidence field
- **THEN** matching items receive only the labels and reason declared by that profile, without domain patterns in core code

### Requirement: Keep rules are parent configuration
The system MUST treat a profile's optional keep rule as the parent configuration for post-classification retention.

#### Scenario: Retain and verify
- **WHEN** the profile keeps `retain` and `verify`
- **THEN** only items with those labels are eligible for optional enrichment

### Requirement: Configure bounded follow-up evidence
The research profile/config MUST support target fields, missing/present conditions, allowlisted hosts, and ordered allowlisted tools for bounded detail collection before classification.

#### Scenario: Missing location triggers profile lookup
- **WHEN** an item lacks a configured location/detail field and has a configured target URL
- **THEN** the runner opens the target only if its host is allowed, runs the configured tools, and merges the result before classification

#### Scenario: No target is available
- **WHEN** the condition matches but the target field is empty or the host is not allowed
- **THEN** the runner skips the follow-up without opening an unconfigured URL.
