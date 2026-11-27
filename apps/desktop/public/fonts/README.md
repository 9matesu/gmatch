# Bundled fonts

`switzer-latin.woff2` and `switzer-latin-italic.woff2` are the **Switzer**
variable typeface by Jerémie Hornus / Indian Type Foundry, downloaded from
Fontshare (upright + italic variable files, weight 100–900). Switzer is the
app's brand face: the boot splash, the shell and the wordmark all render it.

Switzer is licensed under the **ITF Free Font License (FFL)** — free for
personal and commercial use. The license text ships with the font in
`../legal/ITF-FFL.txt`, as the license requires.

Bundling them is what lets the app render the same face offline: there is no
`cdn.fontshare.com` request on a cold start.

`geist-latin.woff2` and `geist-latin-ext.woff2` are the previous face (Geist,
SIL OFL 1.1). They are no longer referenced by the app; kept only as a local
fallback and can be removed once nothing links them.