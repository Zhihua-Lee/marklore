// Source-only transformations: one reversible editor transaction, no HTML roundtrip.
export function markdownEdit(text, from, to, action, options = {}) {
  const selected = text.slice(from, to);
  const result = (
    start,
    end,
    insert,
    a = start,
    b = start + insert.length,
  ) => ({
    changes: { from: start, to: end, insert },
    selection: { anchor: a, head: b },
  });
  const wraps = {
    bold: "**",
    italic: "*",
    strike: "~~",
    inline: "`",
    inlineMath: "$",
  };
  if (Object.hasOwn(wraps, action)) {
    let mark = wraps[action];
    if (action === "inline" && selected.includes("`"))
      mark = "`".repeat(
        Math.max(...[...selected.matchAll(/`+/g)].map((m) => m[0].length)) + 1,
      );
    const n = mark.length;
    if (
      selected.length >= 2 * n &&
      selected.startsWith(mark) &&
      selected.endsWith(mark) &&
      (action !== "italic" ||
        (selected.match(/^\*+/)[0].length % 2 === 1 &&
          selected.match(/\*+$/)[0].length % 2 === 1))
    )
      return result(from, to, selected.slice(n, -n));
    if (
      text.slice(Math.max(0, from - n), from) === mark &&
      text.slice(to, to + n) === mark &&
      (action !== "italic" ||
        (text.slice(0, from).match(/\*+$/)[0].length % 2 === 1 &&
          text.slice(to).match(/^\*+/)[0].length % 2 === 1))
    )
      return result(from - n, to + n, selected);
    const body = selected || (action === "inlineMath" ? "x" : "文字");
    const pad = action === "inline" && /^`|`$/.test(body) ? " " : "";
    return result(
      from,
      to,
      mark + pad + body + pad + mark,
      from + n + pad.length,
      from + n + pad.length + body.length,
    );
  }
  const block = (body, selectOffset = 0, selectLength = body.length) => {
    const before = text.slice(0, from),
      after = text.slice(to);
    const prefix = before
      ? before.endsWith("\n\n")
        ? ""
        : before.endsWith("\n")
          ? "\n"
          : "\n\n"
      : "";
    const suffix = after
      ? after.startsWith("\n\n")
        ? ""
        : after.startsWith("\n")
          ? "\n"
          : "\n\n"
      : "\n";
    return result(
      from,
      to,
      prefix + body + suffix,
      from + prefix.length + selectOffset,
      from + prefix.length + selectOffset + selectLength,
    );
  };
  if (action === "code") {
    const fence = "`".repeat(
      Math.max(3, ...[...selected.matchAll(/`+/g)].map((m) => m[0].length + 1)),
    );
    const body = selected || "代码";
    const language = (options.language || "").replace(/[^\w+#.-]/g, "");
    return block(
      `${fence}${language}\n${body}\n${fence}`,
      fence.length + language.length + 1,
      body.length,
    );
  }
  if (action === "math") {
    const body = selected || "x^2";
    return block(`$$\n${body}\n$$`, 3, body.length);
  }
  if (action === "rule") return block("---", 3, 0);
  if (action === "table") {
    const columns = Number(options.columns),
      rows = Number(options.rows);
    if (
      !Number.isInteger(columns) ||
      columns < 1 ||
      columns > 12 ||
      !Number.isInteger(rows) ||
      rows < 1 ||
      rows > 30
    )
      throw Error("表格范围：1–12 列，1–30 行");
    const line = (cells) => "| " + cells.join(" | ") + " |";
    const header = Array.from({ length: columns }, (_, i) => `列 ${i + 1}`);
    const body = [
      line(header),
      line(header.map(() => "---")),
      ...Array.from({ length: rows }, () => line(header.map(() => " "))),
    ].join("\n");
    return block(body, 2, header[0].length);
  }
  if (action === "link" || action === "image") {
    const url = (options.url || "").trim();
    if (
      !url ||
      /[\r\n\0]/.test(url) ||
      (/^[a-z][a-z\d+.-]*:/i.test(url) &&
        !/^(?:https?:|mailto:|tel:|[a-z]:[\\/])/i.test(url))
    )
      throw Error("请输入有效的链接或本地路径");
    const label = (
      options.label ||
      selected ||
      (action === "image" ? "图片" : "链接")
    )
      .replace(/[\r\n]+/g, " ")
      .replace(/[\\\[\]]/g, "\\$&");
    const destination = url
      .replace(/\\/g, "/")
      .replace(/[<>\s"]/g, (c) => encodeURIComponent(c));
    const body = `${action === "image" ? "!" : ""}[${label}](<${destination}>)`;
    return action === "image" ? block(body) : result(from, to, body);
  }
  const start = from === 0 ? 0 : text.lastIndexOf("\n", from - 1) + 1;
  const last = to > from && text[to - 1] === "\n" ? to - 1 : to;
  const newline = text.indexOf("\n", last);
  const end = newline < 0 ? text.length : newline;
  const lines = text.slice(start, end).split("\n");
  if (action === "heading") {
    const level = Number(options.level);
    if (!Number.isInteger(level) || level < 0 || level > 6)
      throw Error("无效标题层级");
    return result(
      start,
      end,
      lines
        .map((line) =>
          line.replace(
            /^( {0,3})(?:#{1,6}\s+)?/,
            `$1${"#".repeat(level)}${level ? " " : ""}`,
          ),
        )
        .join("\n"),
    );
  }
  const patterns = {
    bullet: /^(\s*)[-+*] (?!\[[ xX]\] )/,
    ordered: /^(\s*)\d+[.)] /,
    task: /^(\s*)[-+*] \[[ xX]\] /,
    quote: /^(\s*)> ?/,
  };
  if (!Object.hasOwn(patterns, action)) throw Error("未知编辑操作");
  const pattern = patterns[action];
  const remove =
    lines.some((l) => l.trim()) &&
    lines.filter((l) => l.trim()).every((l) => pattern.test(l));
  let number = 0;
  const output = lines
    .map((line) => {
      if (!line.trim() && lines.length > 1) return line;
      if (remove) return line.replace(pattern, "$1");
      const clean =
        action === "quote"
          ? line
          : line.replace(/^(\s*)(?:[-+*] (?:\[[ xX]\] )?|\d+[.)] )/, "$1");
      const prefix = {
        bullet: "- ",
        ordered: `${++number}. `,
        task: "- [ ] ",
        quote: "> ",
      }[action];
      return clean.replace(/^(\s*)/, "$1" + prefix);
    })
    .join("\n");
  return result(start, end, output);
}
