Grok Build Usage adds live Grok Build subscription usage to bb's Usage Limits
page. It registers a discoverable `provider-usage.v1` source so Grok Build
appears alongside bb's other provider usage cards.

The plugin reads the Grok CLI credential on each host, checks the Grok Build
billing and settings endpoints, and reports the current plan, credit window,
percentage used and reset time. Weekly and legacy monthly responses are
supported. Not-installed, unauthenticated, expired and billing-error states
are passed through so bb can show the appropriate guidance.

The plugin adds a companion provider named `grok-build-usage` while leaving bb's
built-in `acp-grok` execution provider untouched. It requires bb 0.44 or newer,
the 0.5.29 plugin SDK, and a `grok` command installed on the host. Run `grok
login` to authenticate.

Usage collection is host-local and read-only. The plugin does not expose the
Grok token, does not write credentials, and does not alter prompts or provider
sessions. Short-lived usage observations are cached in memory for up to 60
seconds unless bb requests a refresh.

MIT licence, © MacHatter1.
