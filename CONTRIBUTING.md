# Contributing

Bug reports and compatibility reports are welcome through GitHub Issues.

When submitting a code change:

1. Keep the public protocol backward compatible whenever possible.
2. Do not include code or assets copied from closed-source or incompatible projects.
3. Validate JSON files and run `node --check` on edited JavaScript files.
4. Test camera recovery with `/sf:reset` after intentional interruption.
5. Describe the Bedrock version and device used for visual tests.
