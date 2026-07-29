export function sanitizeDocxHtml(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set(["A", "P", "BR", "STRONG", "EM", "B", "I", "U", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "BLOCKQUOTE", "IMG"]);
  document.body.querySelectorAll("*").forEach((element) => {
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    for (const attribute of Array.from(element.attributes)) {
      const isSafeHref = element.tagName === "A" && attribute.name === "href" && /^(https?:|mailto:)/i.test(attribute.value);
      const isSafeImage = element.tagName === "IMG" && attribute.name === "src" && attribute.value.startsWith("data:image/");
      if (!isSafeHref && !isSafeImage) element.removeAttribute(attribute.name);
    }
  });
  return document.body.innerHTML;
}
