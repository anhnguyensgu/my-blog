# Template Contract

Markdown files should only provide post metadata and article content. They should not include the full HTML document, sidebar, navigation, or stylesheet link.

Generation flow:

```text
content/post.md
  -> parse front matter
  -> convert Markdown body to HTML
  -> insert HTML into templates/post.html as {{{content_html}}}
  -> insert rendered page into templates/layout.html as {{content}}
  -> write public/posts/post/index.html
```

The shared stylesheet is loaded by each page template:
The shared document shell lives in `templates/layout.html`:

```html
<link rel="stylesheet" href="{{site.asset_path}}style.css?v={{site.asset_version}}">
```

The Markdown output must be wrapped by:

```html
<div class="article-body">
{{{content_html}}}
</div>
```

That wrapper is what makes raw CommonMark output such as `p`, `h2`, `blockquote`, `pre code`, `ul`, and `ol` inherit the blog design.
