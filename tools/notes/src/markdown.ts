// Rendu Markdown minimal et sûr : le texte est d'abord échappé, puis mis en forme.
// Pris en charge : # / ## / ###, **gras**, *italique*, `code`, ```blocs```, - listes,
// 1. listes, - [ ] / - [x] cases à cocher (cliquables), > citations, --- séparateurs, liens.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
}

/** HTML de prévisualisation. Les cases à cocher portent data-line (index de ligne source). */
export function renderMarkdown(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let inCode = false;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  lines.forEach((line, i) => {
    if (line.trim().startsWith("```")) {
      closeList();
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      return;
    }
    if (inCode) {
      out.push(escapeHtml(line) + "\n");
      return;
    }
    const task = /^\s*[-*] \[( |x|X)\] (.*)$/.exec(line);
    const bullet = /^\s*[-*] (.*)$/.exec(line);
    const ordered = /^\s*\d+\. (.*)$/.exec(line);
    if (task) {
      if (list !== "ul") {
        closeList();
        out.push('<ul class="tasks">');
        list = "ul";
      }
      const done = task[1].toLowerCase() === "x";
      out.push(
        `<li class="${done ? "done" : ""}"><input type="checkbox" data-line="${i}" ${done ? "checked" : ""}/> <span>${inline(task[2])}</span></li>`,
      );
      return;
    }
    if (bullet || ordered) {
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((bullet ?? ordered)![1])}</li>`);
      return;
    }
    closeList();
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    else if (/^\s*---\s*$/.test(line)) out.push("<hr/>");
    else if (line.startsWith("> ")) out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    else if (line.trim() === "") out.push("");
    else out.push(`<p>${inline(line)}</p>`);
  });
  closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

/** Coche / décoche la case de la ligne `index`. */
export function toggleTask(source: string, index: number): string {
  const lines = source.split("\n");
  const line = lines[index] ?? "";
  lines[index] = /\[( )\]/.test(line) ? line.replace("[ ]", "[x]") : line.replace(/\[(x|X)\]/, "[ ]");
  return lines.join("\n");
}

export function stats(source: string) {
  const words = source.trim() ? source.trim().split(/\s+/).length : 0;
  const total = (source.match(/^\s*[-*] \[( |x|X)\]/gm) ?? []).length;
  const done = (source.match(/^\s*[-*] \[(x|X)\]/gm) ?? []).length;
  return { words, total, done };
}

/** Aperçu texte brut d'une note (liste). */
export function snippet(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,3} /gm, "")
    .replace(/^\s*[-*] \[( |x|X)\] /gm, "• ")
    .replace(/[*`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
}
