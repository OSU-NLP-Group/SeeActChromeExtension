# Changelog
Nontrivial changes to the extension are documented here.


## [Unreleased]
### Added
- ability to view and revise the choice of severity level for the previous action annotation
- ability to see how many action annotations have been made so far in the current batch
- better handling of annotator side panel state reset when background or content scripts encounter problem during batch
- better handling of annotator side panel elements being disabled when appropriate
- improved visual rendering for disabled elements
### Updated
- QoL improvement: severity dropdown stays at prior value after an annotation
  - often you'll annotate a bunch of elements with the same level in a row
  - the collapsing of MEDIUM into HIGH has made a streak of HIGH annotations more likely
### Removed
- MEDIUM level for action state change severity (incorporated into HIGH level per researcher decision)


## [1.1.0.A] - 2025-01-03?
TODO

## [1.0.2.A] - 2024-12-19
First annotator-mode-only version 

### Updated
- Some things to just refer to logs exporting rather than agent controller (including user manual)
### Removed
- all UI elements related to the agent controller

## [1.0.1] - 2024-11-24
### Updated
- Fix problem from Anthropic API update which prevented use of Claude as agent
- Fix links not having special rendering
- Fix URL's pointing to personal repository rather than OSU NLP Group repository
- Fix installation greeting page not alerting the user when keyboard shortcuts weren't loaded correctly

## [1.0.0] - 2024-11-11
### Added
- User docs for annotator mode, which can be accessed from within the extension's side panel
- Open RAIL-S license
### Updated
- Reduce risk of previous annotation's element highlighting still being visible in the context screenshot of the next annotation
- Installation instructions in README.md
- Various details in README.md, user manual, and privacy policy

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

