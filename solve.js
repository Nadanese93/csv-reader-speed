// solve.js — a fast drop-in for csv-reader 1.0.0 (make.fun csv-reader-speed).
//
// Written from the prose specification in competition.yaml / RULES.txt only.
// Single-pass slice scanner: a record whose whole line holds no quote and
// no CR is split with one C++ split(',') call; otherwise fields are parsed
// against a cached copy of the current line, so every delimiter search is
// bounded by the line length instead of the rest of the file; a quote state
// machine runs only when a quote opens a field. No per-field allocation
// beyond the result strings themselves.
//
// Specification (as implemented):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes, a CR not followed by LF is dropped (error stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside is one quote; each CRLF or lone CR inside is read as LF; what
//   follows the closing quote up to the next comma or line break is appended
//   as it stands (error quote_junk, when the field ends — but only when some
//   junk text is actually appended; stray CRs dropped there are not junk);
//   a quote that never closes is a literal character and the text after it
//   is read again as unquoted (error unterminated_quote).
// - A quote inside an unquoted field is a literal character.
// - A lone CR dropped at the start of a line is the first character of the
//   record's first field, so that field is read as unquoted (a quote after
//   the CR is a literal character); an empty line after it clears this.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows holds
//   the records after it (every record when header is false), each padded
//   with "" (short_row, with fields: its field count) or cut (long_row, with
//   extra: the cut fields) to the first record's width.
// - Each error is {code, line, row} in the order met; line is the 1-based
//   line the error's record starts on for every error code (verified
//   against the practice set), counting every LF, CRLF and lone CR inside
//   quotes, and row is the record's index in rows, null for the header.
//   (A stray CR met between records, before the next record starts,
//   carries the current line instead.)
// - With header true and no records at all, columns is [].

const COMMA = 44; // ,
const QUOTE = 34; // "
const CR = 13; // \r
const LF = 10; // \n
const BOM = 0xfeff;

export function run(input) {
  const text = input.text;
  const header = input.header;
  const n = text.length;

  let pos = 0;
  if (n > 0 && text.charCodeAt(0) === BOM) pos = 1;

  const errors = [];
  const rows = [];
  // With header true and no records at all, columns is [] (not null).
  let columns = header ? [] : null;
  let width = -1;
  let line = 1; // 1-based line of the character at pos
  let firstRecord = true;
  // 1-based line the record currently being built starts on. Every error
  // the reference reports for a record carries this line, not the line
  // where the offending character sits (verified against the practice set:
  // record-start line matches all 546 non-short/long errors, the current
  // line only 508).
  let recordStartLine = 1;

  // Row index the record currently being built will have in `rows`
  // (null while the header record is being built).
  const curRow = () => (firstRecord && header ? null : rows.length);

  // Cached copy of the line `pos` is on: lineText covers
  // [lineBase, lineEnd); lineHasNL says the line ends with a real LF
  // (false when it runs to the end of the input).
  let lineBase = 0;
  let lineEnd = -1;
  let lineText = '';
  let lineHasNL = false;
  function ensureLine() {
    const nl = text.indexOf('\n', pos);
    lineHasNL = nl !== -1;
    lineEnd = lineHasNL ? nl : n;
    lineBase = pos;
    lineText = text.slice(pos, lineEnd);
  }

  // Drop every CR in `value` (all of them are lone CRs by construction at
  // the call sites) and report one stray_cr per CR dropped.
  function stripCRs(value) {
    const parts = value.split('\r');
    if (parts.length === 1) return value;
    for (let k = 1; k < parts.length; k++) {
      errors.push({ code: 'stray_cr', line: recordStartLine, row: curRow() });
    }
    return parts.join('');
  }

  // Parse one field starting at pos. Sets `sep` to 'comma' | 'eol' | 'eof'
  // and advances pos past the field and its terminator.
  let sep = 'eof';

  // Unquoted field, parsed against the cached line. `pos` is on the cached
  // line, or just past its end (empty last field after a trailing comma).
  function parseUnquoted() {
    const rel = pos - lineBase;
    const ci = lineText.indexOf(',', rel);
    if (ci !== -1) {
      let value = lineText.slice(rel, ci);
      pos = lineBase + ci + 1;
      if (value.indexOf('\r') !== -1) value = stripCRs(value);
      sep = 'comma';
      return value;
    }
    let value = lineText.slice(rel);
    if (lineHasNL && value.charCodeAt(value.length - 1) === CR) {
      // CRLF terminator: the trailing CR is not a stray one.
      value = value.slice(0, -1);
      if (value.indexOf('\r') !== -1) value = stripCRs(value);
      pos = lineEnd + 1;
      line++;
      sep = 'eol';
      return value;
    }
    if (value.indexOf('\r') !== -1) value = stripCRs(value);
    if (lineHasNL) {
      pos = lineEnd + 1;
      line++;
      sep = 'eol';
    } else {
      pos = n;
      sep = 'eof';
    }
    return value;
  }

  function parseQuoted() {
    // Find the closing quote, skipping doubled quotes ("").
    let scan = pos + 1;
    let close = -1;
    let escaped = false;
    for (;;) {
      const q = text.indexOf('"', scan);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === QUOTE) {
        escaped = true;
        scan = q + 2;
        continue;
      }
      close = q;
      break;
    }
    if (close === -1) {
      // A quote that never closes is a literal character; the text after
      // it is read again as unquoted.
      errors.push({ code: 'unterminated_quote', line: recordStartLine, row: curRow() });
      if (pos > lineEnd) ensureLine();
      return parseUnquoted();
    }

    const start = pos + 1;
    // Line breaks inside the quoted field count toward `line`: each LF,
    // each CRLF (one, via its LF) and each lone CR. Everything below scans
    // only the field's own segment, never past its closing quote.
    const segment = text.slice(start, close);
    let nlCount = 0;
    for (let i = segment.indexOf('\n'); i !== -1; i = segment.indexOf('\n', i + 1)) nlCount++;
    line += nlCount;
    let value;
    if (!escaped && segment.indexOf('\r') === -1) {
      value = segment;
    } else {
      let loneCR = 0;
      for (let i = segment.indexOf('\r'); i !== -1; i = segment.indexOf('\r', i + 1)) {
        if (segment.charCodeAt(i + 1) !== LF) loneCR++;
      }
      line += loneCR;
      value = escaped
        ? segment.replace(/""/g, '"').replace(/\r\n?/g, '\n')
        : segment.replace(/\r\n?/g, '\n');
    }

    pos = close + 1;
    // What follows the closing quote up to the next comma or line break is
    // appended as it stands (quote_junk, when the field ends).
    if (pos >= n) {
      sep = 'eof';
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === COMMA) {
      pos++;
      sep = 'comma';
      return value;
    }
    if (c === LF) {
      pos++;
      line++;
      sep = 'eol';
      return value;
    }
    if (c === CR) {
      if (pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line++;
        sep = 'eol';
        return value;
      }
      // Lone CR: dropped, error, junk continues past it.
      errors.push({ code: 'stray_cr', line: recordStartLine, row: curRow() });
      pos++;
    }
    // Junk scan: append everything up to the next comma or line break.
    // quote_junk is only reported when some junk text is actually
    // appended: stray CRs dropped between the closing quote and the
    // delimiter are not junk by themselves.
    const parts = [];
    let junkLen = 0;
    for (;;) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      const cr = text.indexOf('\r', pos);
      let d = -1;
      let kind = 0;
      if (comma !== -1) { d = comma; kind = 1; }
      if (lf !== -1 && (d === -1 || lf < d)) { d = lf; kind = 2; }
      if (cr !== -1 && (d === -1 || cr < d)) { d = cr; kind = 3; }
      if (d === -1) {
        junkLen += n - pos;
        parts.push(text.slice(pos, n));
        pos = n;
        sep = 'eof';
        break;
      }
      if (kind === 1) {
        junkLen += d - pos;
        parts.push(text.slice(pos, d));
        pos = d + 1;
        sep = 'comma';
        break;
      }
      if (kind === 2) {
        junkLen += d - pos;
        parts.push(text.slice(pos, d));
        pos = d + 1;
        sep = 'eol';
        break;
      }
      if (d + 1 < n && text.charCodeAt(d + 1) === LF) {
        junkLen += d - pos;
        parts.push(text.slice(pos, d));
        pos = d + 2;
        sep = 'eol';
        break;
      }
      // Lone CR inside the junk: dropped, error, junk continues.
      errors.push({ code: 'stray_cr', line: recordStartLine, row: curRow() });
      junkLen += d - pos;
      parts.push(text.slice(pos, d));
      pos = d + 1;
    }
    if (junkLen > 0) {
      errors.push({ code: 'quote_junk', line: recordStartLine, row: curRow() });
      value += parts.join('');
    }
    if (sep === 'eol') line++;
    return value;
  }

  // Whether the record about to start opens in unquoted mode: a lone CR
  // dropped at the start of a line is the first character of the record's
  // first field, so that field is read as unquoted (a quote after it is a
  // literal character). An empty line after it clears this again.
  let firstFieldUnquoted = false;

  while (pos < n) {
    // Skip empty lines: a line left with no characters is no record.
    const ch = text.charCodeAt(pos);
    if (ch === LF) {
      pos++;
      line++;
      firstFieldUnquoted = false;
      continue;
    }
    if (ch === CR) {
      if (pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line++;
        firstFieldUnquoted = false;
        continue;
      }
      // Lone CR at the start of a line: dropped (error); the line's
      // remaining characters still belong to the record that follows.
      // This one is met between records, so it carries the current line
      // (the next record's start line), not the previous record's.
      errors.push({ code: 'stray_cr', line, row: curRow() });
      pos++;
      firstFieldUnquoted = true;
      continue;
    }

    // Parse one record.
    recordStartLine = line;
    ensureLine();
    let fields;
    // Fast path: the whole record fits on this one line with no quotes and
    // no CRs, so it is just comma-separated fields (split runs in C++).
    // A quote anywhere on the line, or a CR, falls back to the general
    // field-by-field parser below, which is the only path that can span
    // lines or drop stray CRs.
    let body = lineText;
    if (lineHasNL && body.charCodeAt(body.length - 1) === CR) {
      body = body.slice(0, -1); // CRLF terminator
    }
    if (
      !firstFieldUnquoted &&
      body.indexOf('"') === -1 &&
      body.indexOf('\r') === -1
    ) {
      fields = body.split(',');
      pos = lineHasNL ? lineEnd + 1 : n;
      line++;
    } else {
      fields = [];
      for (;;) {
        if (pos > lineEnd) ensureLine();
        const field =
          !firstFieldUnquoted && pos < n && text.charCodeAt(pos) === QUOTE
            ? parseQuoted()
            : parseUnquoted();
        firstFieldUnquoted = false;
        fields.push(field);
        if (sep !== 'comma') break;
      }
    }

    if (firstRecord) {
      width = fields.length;
      if (header) {
        columns = fields;
      } else {
        rows.push(fields);
      }
      firstRecord = false;
    } else {
      const row = rows.length;
      if (fields.length < width) {
        errors.push({
          code: 'short_row',
          line: recordStartLine,
          row,
          fields: fields.length,
        });
        while (fields.length < width) fields.push('');
      } else if (fields.length > width) {
        const extra = fields.slice(width);
        errors.push({
          code: 'long_row',
          line: recordStartLine,
          row,
          extra,
        });
        fields.length = width;
      }
      rows.push(fields);
    }
  }

  return { columns, rows, errors };
}
