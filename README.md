# OsuNlpGrpSeeActChromeExtension

Chrome extension to allow end-users to leverage the logic/behavior of the Python code in the SeeAct repository (i.e.
just installing a chrome extension from chrome web store rather than having to install python and playwright locally and
then download/run SeeAct).

# Conventions

## Typescript

Files which export multiple utility methods will have all_lowercase names. Files which export a single class will have
PascalCase names.

## Testing

White-box as well as black-box types of unit tests (both using jest).
