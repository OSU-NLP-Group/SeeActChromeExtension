# Changelog
Nontrivial changes to the extension are documented here.


## [Unreleased]
### Added

### Updated

### Removed


## [0.4.1] - 2024-09-02
### Updated
- annotation tool auto-concludes batch in sensible way when user navigates away before explicitly terminating the batch
### Removed
- unnecessary warning messages

## [0.4.0] - 2024-08-31
### Added
- a batch-wide information json in each annotation batch zip (including the identifying details of the version of the extension that was used to generate that batch of annotations)

### Updated
- version number is included at the top of each logs-export file
- element highlighting's dynamic color choice always picks a maximally saturated color
- side panel's annotator UI gives more informative status messages when an annotation is captured

### Removed
- draft/template EULA is no longer displayed upon first install
- remove files from build output that aren't needed at runtime

