# Changelog
Nontrivial changes to the extension are documented here.


## [Unreleased]
### Added

### Updated

### Removed

## [0.5.1] - 2024-09-16
### Added
- Ability for annotator to specify that a batch will only cover elements in a dialog (which's blocking interaction with the rest of the page)
  - this doesn't yet try to scroll through the dialog's content, but it does stop some annoying misbehaviors that would occur when capturing general page info in a dialog scenario
### Updated
- Cross-origin iframe handling: logs will be clearer about whether an element with no description was a cross-origin iframe, and the check for an iframe being cross-origin was made more robust
- All log timestamps to try to use 'performance.now()' for somewhat clearer ordering of messages

## [0.5.0] - 2024-09-14
### Added
- Ability to limit misc logs download to just the last hour
### Removed
- The capturing of the second screenshot ('targeted' type) for a given annotation
  - this ultimately isn't needed for creating the needed datasets from the annotation batch zips, and it was making Chrome's limitation of only 2 captures of the visible tab per second even more annoying than it had to be

## [0.4.2] - 2024-09-11
### Updated
- Fix for Github issue 16 (large batches failing during the 'end batch and download zip file' step because of Chrome limitation on size of messages over extension 'ports')
  - messages for file downloads are now automatically 'chunked' if the file to be downloaded is too large  
- Fix for Github issue 17 (batch terminated by taking annotations too quickly and running into Chrome limitation on screenshot frequency)
- Fix for Github issue 18 (infinite recursion in weird scenario with nested shadow DOM's)
- Change default log level to DEBUG
- Fix notification messages being cleared too quickly sometimes

## [0.4.1] - 2024-09-02
### Updated
- Annotation tool auto-concludes batch in sensible way when user navigates away before explicitly terminating the batch
### Removed
- Unnecessary warning messages

## [0.4.0] - 2024-08-31
### Added
- A batch-wide information json in each annotation batch zip (including the identifying details of the version of the extension that was used to generate that batch of annotations)

### Updated
- Version number is included at the top of each logs-export file
- Element highlighting's dynamic color choice always picks a maximally saturated color
- Side panel's annotator UI gives more informative status messages when an annotation is captured

### Removed
- Draft/template EULA is no longer displayed upon first install
- Remove files from build output that aren't needed at runtime

