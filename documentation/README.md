# Rolling Bites — Food Truck & Street Food HTML Template

A premium, Bootstrap 5.3 street-food / food truck website template with layered
parallax effects, scroll reveal animations, floating decorative elements, full
light/dark mode, and RTL support.

## Structure

```
food-truck-template/
├── index.html              Home 1 — modern food truck landing
├── home-2.html              Home 2 — immersive street food experience
├── about.html                About Us — story, founder, timeline, team
├── services.html             Services grid (catering, events, hire...)
├── service-details.html      Catering service detail, pricing & FAQs
├── menu.html                 Filterable food menu
├── truck-location.html       Weekly schedule & map placeholder
├── blog.html                 Blog listing with search & filters
├── blog-details.html         Full article + sidebar
├── contact.html               Contact / catering enquiry form
├── 404.html                   Themed error page
├── coming-soon.html           Countdown + email capture
├── assets/
│   ├── css/
│   │   ├── style.css          Core design system (tokens, layout, components)
│   │   ├── dark-mode.css      [data-theme="dark"] overrides
│   │   └── rtl.css            [dir="rtl"] overrides
│   ├── js/
│   │   ├── main.js            Nav, theme, filters, search, forms, reveal, stats
│   │   └── parallax.js        rAF-based transform parallax (data-speed elements)
│   ├── images/                (bring your own optimized images here)
│   └── fonts/                 (self-host fonts here if not using Google Fonts CDN)
└── documentation/README.md    This file
```

> Note: all HTML pages live at the project root (not under /pages) so that every
> relative link (`assets/css/style.css`, `menu.html`, etc.) works identically
> from any page without path-rewriting. If you prefer a `/pages` subfolder,
> move the files there and prefix asset paths with `../`.

## Getting Started

1. Open `index.html` in a browser — no build step required.
2. Replace the Unsplash placeholder image URLs with your own optimized
   WebP/AVIF images in `assets/images/`.
3. Update brand name, contact details, menu items and pricing directly in
   the HTML (search for "Rolling Bites", "₹", "+91").
4. Wire up the map placeholders (`.map-placeholder`) with your Google Maps
   embed or API integration.
5. Point the contact form (`contact.html`) at your backend or a form
   service (Formspree, Netlify Forms, etc.) — client-side validation is
   already wired up via Bootstrap's `needs-validation` pattern.

## Dark Mode

Toggled via the moon/sun icon in the header. Preference is stored in
`localStorage` under `rb-theme` and falls back to the OS-level
`prefers-color-scheme` on first visit. All colors are CSS custom properties
in `style.css`, overridden in `dark-mode.css`.

## RTL Support

Set `dir="rtl"` on the `<html>` element (or add a toggle button with the
`data-rtl-toggle` attribute) to flip navigation, spacing, icons and text
alignment via `rtl.css`. Tested with Arabic/Hebrew-style layouts.

## Parallax & Motion

- `data-speed="0.25"` (etc.) on any element enables translate3d-based
  parallax via `parallax.js`, throttled with `requestAnimationFrame` and
  paused when the element is off-screen.
- `.parallax-section` uses `background-attachment: fixed` for full-width
  background parallax (falls back to scroll on mobile/tablet for
  performance).
- `.reveal`, `.reveal-left`, `.reveal-right`, `.reveal-zoom`, `.reveal-img`
  trigger via `IntersectionObserver` in `main.js`.
- All motion is disabled when the OS `prefers-reduced-motion: reduce` is
  set.

## Filters & Search

- Menu page: `data-filter-group` + `.filter-btn[data-filter]` +
  `[data-category]` on items — see `menu.html` for the pattern.
- Blog page: same filter pattern plus a live text search via
  `[data-blog-search]` and `[data-search-item][data-title]`.

## Customization Tokens

All brand colors, radii, shadows and fonts are defined as CSS variables at
the top of `assets/css/style.css` under `:root`. Change them once to
re-theme the entire site.

## Browser & Performance Notes

- Built for Bootstrap 5.3+, Bootstrap Icons 1.11+.
- Uses `transform: translate3d()` and `will-change` for parallax — avoid
  animating `top`/`left`/`margin` if you extend this template.
- Lazy-loads all below-the-fold images (`loading="lazy"`); hero image is
  preloaded.
- No console.log statements are shipped in production JS.

## License

This is a template deliverable — customize freely for your own project.
