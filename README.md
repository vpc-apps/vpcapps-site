# vpcapps.net

Static studio website of VPC Apps (games + apps), served by GitHub Pages from `main` with the custom domain in `CNAME`.

- Build: `python -I tools/build.py` (pages, sitemap, robots, app-ads.txt). `--assets` also re-imports images, videos, the Fredoka font and the hosted game builds from `../APPs` (Phaser website targets in `docs/marketing/phaser/website/`) and `../vpconsulting-apps-site` (legacy privacy pages, Pop Pairs JS demo).
- Content: `tools/content.py` (games, studio facts); long game texts come from `APPs/docs/store_listings/<game>.md`.
- Games: `/play/<slug>/` = hosted build (Phaser or JS). Games without a Phaser build yet are embedded from the old site (`vpc-apps.github.io/play/<slug>/`) until their port exists: set `web='local'` in content.py once `<game>_phaser_website` exists and rebuild with `--assets`.
- Ads: none. Game pages carry an empty `<div class="ad-slot" hidden>`; no ad code until AdSense is approved (see APPs/docs/website_v2.md).
- The old site (vpc-apps.github.io) keeps the Play apps' privacy pages + app-ads.txt that Google Play and AdMob point to. Never put a CNAME on that repo.
