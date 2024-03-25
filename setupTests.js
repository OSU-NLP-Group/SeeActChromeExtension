//todo in mid april, see whether this hacky patch can be replaced by using jest-fixed-jsdom
// not using it yet b/c it's literally less than a month old
// https://github.com/mswjs/jest-fixed-jsdom#readme
// that would also allow removing the direct dependency on util in package.json
const {TextEncoder, TextDecoder} = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;