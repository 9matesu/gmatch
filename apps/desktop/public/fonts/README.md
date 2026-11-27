# Bundled fonts

`geist-latin.woff2` and `geist-latin-ext.woff2` are the **Geist** variable
typeface by Vercel, downloaded from the Google Fonts CDN (subset files, weight
100–900).

Geist is licensed under the **SIL Open Font License 1.1**
(https://openfontlicense.org). The license text ships with the font in
`OFL.txt` (this directory), which is the condition the license sets for
redistributing it.

Bundling them is what lets the app render the same face offline: there is no
`fonts.googleapis.com` request on a cold start.