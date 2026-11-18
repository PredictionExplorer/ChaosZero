// Vite, Vitest, tinyglobby and fdir use these matching and scanning operations. Use Minimatch
// for both matching and pattern detection so the walker agrees with its filter.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- fdir and the ESLint plugin also require this module through CommonJS.
const { Minimatch } = require("minimatch");

// Match Minimatch's length ceiling. Check brace depth before Minimatch parses
// alternatives, including for scan(). Brace expansion runs before character
// class parsing. Escaped braces are literals; adjacent groups do not nest.
const MAX_PATTERN_LENGTH = 64 * 1024;
const MAX_BRACE_DEPTH = 64;

function isSupportedPattern(pattern, options = {}) {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  if (options.nobrace || pattern.length <= MAX_BRACE_DEPTH) return true;
  let depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") i++;
    else if (ch === "{") {
      if (++depth > MAX_BRACE_DEPTH) return false;
    } else if (ch === "}" && depth > 0) depth--;
  }
  return true;
}

function checkPattern(pattern, options) {
  if (!isSupportedPattern(pattern, options))
    throw new RangeError("Tooling glob exceeds pattern limits");
}

function compiler(pattern, options) {
  checkPattern(pattern, options);
  return new Minimatch(pattern, {
    ...options,
    noext: options.noextglob ?? options.noext,
    matchBase: options.basename ?? options.matchBase,
    nocomment: true,
    nonegate: options.nonegate || (!options.noextglob && pattern.startsWith("!(")),
    // Vite and tinyglobby both normalize their paths to forward slashes.
    platform: "linux",
  });
}

function createMatcher(patterns, options = {}) {
  const globs = Array.isArray(patterns) ? patterns : [patterns];
  const filters = globs.map((pattern) => {
    if (options.contains) {
      // Coverage looks for include/exclude globs inside absolute filenames.
      // Keep substring matching in the bounded glob engine. An interior match
      // can end in the filename itself or in one of its parent segments.
      const prefix = pattern.startsWith("**/") ? "" : pattern.startsWith("/") ? "**" : "**/";
      const start = prefix.endsWith("/") && !pattern.startsWith("*") ? "*" : "";
      const end = pattern.endsWith("*") ? "" : "*";
      const anywhere = compiler(prefix + start + pattern + end, options);
      return (path) => {
        for (let part = path; ;) {
          if (anywhere.match(part)) return true;
          const slash = part.lastIndexOf("/");
          if (slash < 0) return false;
          part = part.slice(0, slash);
        }
      };
    }
    const matcher = compiler(pattern, options);
    const includeDirectory = pattern.endsWith("/**") && !options.strictSlashes;
    return (path) => matcher.match(path) || (includeDirectory && matcher.match(path + "/"));
  });
  const ignore = options.ignore && createMatcher(options.ignore, { ...options, ignore: undefined });
  return (input) => {
    const path =
      (options.windows ?? process.platform === "win32") ? input.replaceAll("\\", "/") : input;
    return (!ignore || !ignore(path)) && filters.some((filter) => filter(path));
  };
}

// tinyglobby uses complete segments to prune directory walks. A slash inside
// a brace alternative or extglob must stay in that segment; tinyglobby then
// conservatively traverses it and evaluates the complete pattern on each file.
function segments(pattern) {
  const parts = [];
  const closing = [];
  let start = 0;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\") {
      i++;
    } else if (char === closing.at(-1)) {
      closing.pop();
    } else if (closing.at(-1) !== "]") {
      if (char === "[") closing.push("]");
      else if (char === "{") closing.push("}");
      else if (char === "(") closing.push(")");
      else if (char === "/" && !closing.length) {
        parts.push(pattern.slice(start, i));
        start = i + 1;
      }
    }
  }
  parts.push(pattern.slice(start));
  return parts;
}

createMatcher.isSupportedPattern = isSupportedPattern;
createMatcher.scan = (input, options = {}) => {
  checkPattern(input, options);
  const negated = !options.nonegate && input.startsWith("!") && !input.startsWith("!(");
  const pattern = (negated ? input.slice(1) : input).replace(/^\.\//, "");
  const parts = segments(pattern);
  const firstGlob = parts.findIndex((segment) =>
    compiler(segment, { ...options, magicalBraces: true, nonegate: true }).hasMagic(),
  );
  const base = firstGlob === -1 ? pattern : parts.slice(0, firstGlob).join("/");
  return {
    base: base || (pattern.startsWith("/") ? "/" : ""),
    parts,
    negated,
    isGlob: firstGlob !== -1,
  };
};

createMatcher.isMatch = (input, patterns, options) => createMatcher(patterns, options)(input);
module.exports = createMatcher;
