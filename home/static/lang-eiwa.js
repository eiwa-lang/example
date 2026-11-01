/* Eiwa language definition for highlight.js, derived from
 * vscode-extension/syntaxes/eiwa.tmLanguage.json.
 * Loaded after highlight.min.js, before highlightAll() runs. */
(function () {
  function eiwa(hljs) {
    const KEYWORDS = {
      keyword:
        "if else when for while do try catch finally throw return leave continue " +
        "fun val var type contract skill enum object class interface lib test companion import from typealias init constructor package " +
        "public private internal protected open abstract final sealed data inner value annotation expect actual override implement lateinit operator infix inline external tailrec suspend const vararg noinline crossinline reified " +
        "is in as of by where get set out",
      literal: "true false null",
      built_in:
        "Int Double Float Long Short Byte UInt ULong Bool Boolean String Char Pointer Void List Map Set MutableList MutableMap MutableSet Array " +
        "print println error assert require repeat TODO this super it field"
    };

    const ESCAPE = {
      scope: "char.escape",
      begin: /\\(u[0-9a-fA-F]{4}|[tbrn'"\\$])/
    };
    const SUBST_SIMPLE = { scope: "variable", begin: /\$[a-zA-Z_][a-zA-Z0-9_]*/ };
    const NUMBER_HEX = { scope: "number", begin: /\b0[xX][0-9a-fA-F_]+[uUL]?\b/ };
    const NUMBER_BIN = { scope: "number", begin: /\b0[bB][01_]+[uUL]?\b/ };
    const NUMBER_FLOAT = {
      scope: "number",
      begin:
        /\b\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d[\d_]*)[fF]?\b|\b\d[\d_]*\.\d[\d_]*[fF]?\b/
    };
    const NUMBER_INT = { scope: "number", begin: /\b\d[\d_]*[uUL]?\b/ };
    const FUNC_CALL = {
      scope: "title.function",
      begin: /\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()/
    };
    const TYPE_NAME = { scope: "title.class", begin: /\b[A-Z][A-Za-z0-9_]*\b/ };
    const CHAR = {
      scope: "string",
      begin: /'(\\(u[0-9a-fA-F]{4}|[tbrn'"\\])|[^'\\\n\r])'/
    };
    // ${...} — mesmo truque do Kotlin: cria vazio e injeta STRING depois
    // para permitir recursao sem TDZ. Com keywords para que this/name
    // dentro de ${this.name} nao fique branco.
    const SUBST_BLOCK = {
      scope: "subst",
      begin: /\$\{/,
      end: /\}/,
      keywords: KEYWORDS,
      contains: [
        NUMBER_HEX,
        NUMBER_BIN,
        NUMBER_FLOAT,
        NUMBER_INT,
        SUBST_SIMPLE,
        FUNC_CALL,
        TYPE_NAME
      ]
    };
    const STRING = {
      scope: "string",
      begin: /"/,
      end: /"/,
      contains: [ESCAPE, SUBST_BLOCK, SUBST_SIMPLE]
    };
    SUBST_BLOCK.contains.push(STRING, CHAR, "self");
    const ANNOTATION = { scope: "meta", begin: /@[A-Za-z_][A-Za-z0-9_]*/ };
    const COMMENT_LINE = hljs.COMMENT("//", "$");
    const COMMENT_BLOCK = hljs.COMMENT("/\\*", "\\*/");

    return {
      name: "Eiwa",
      aliases: ["ei"],
      keywords: KEYWORDS,
      contains: [
        hljs.SHEBANG(),
        COMMENT_LINE,
        COMMENT_BLOCK,
        ANNOTATION,
        STRING,
        CHAR,
        NUMBER_HEX,
        NUMBER_BIN,
        NUMBER_FLOAT,
        NUMBER_INT,
        FUNC_CALL,
        TYPE_NAME
      ]
    };
  }

  if (typeof window !== "undefined" && window.hljs) {
    window.hljs.registerLanguage("eiwa", eiwa);
  } else if (typeof globalThis !== "undefined" && globalThis.hljs) {
    globalThis.hljs.registerLanguage("eiwa", eiwa);
  } else {
    // hljs not loaded yet (deferred): retry on DOMContentLoaded
    document.addEventListener("DOMContentLoaded", function () {
      if (window.hljs && !window.hljs.getLanguage("eiwa")) {
        window.hljs.registerLanguage("eiwa", eiwa);
      }
    });
  }
})();
