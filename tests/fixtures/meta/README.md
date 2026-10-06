HAND-AUTHORED contract fixtures for the Facebook Pages connector. They are NOT recordings from the live Graph API.
They were written from excerpts of Meta's official documentation (developers.facebook.com; see the header of
server/services/social/connectors/metaGraph.ts for the page list) because the docs could not be fetched in full in the build
environment. After the first real test in Development mode, replace them with recorded payloads and re-run
`tests/unit/facebookConnector.test.ts` to see exactly where reality differs.
