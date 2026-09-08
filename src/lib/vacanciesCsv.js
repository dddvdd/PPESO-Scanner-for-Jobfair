export const VACANCY_HEADERS = ["Company Name", "Vacancy Title/ Position", "Number of Vacancies"];
export const MAX_VACANCY_ROWS = 5000;

// RFC-style quoted CSV: commas, escaped quotes, CRLF, and multiline cells.
function csvRows(input) {
  const text = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", quoted = false, closed = false;
  function endCell() { row.push(cell); cell = ""; closed = false; }
  function endRow() {
    endCell();
    if (row.some(value => value.trim())) rows.push(row);
    if (rows.length > MAX_VACANCY_ROWS + 1) throw new Error(`Upload at most ${MAX_VACANCY_ROWS} vacancies at a time.`);
    row = [];
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === ",") endCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else if (closed) {
      if (!/\s/.test(char)) throw new Error("Unexpected text after a quoted CSV value.");
    } else if (char === '"') {
      if (cell.length) throw new Error("Quotes inside a CSV value must be escaped and enclosed in quotes.");
      quoted = true;
    } else cell += char;
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted value.");
  endRow();
  return rows;
}

const normalizeHeader = value => value.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/");

export function parseVacanciesCsv(text) {
  const [header, ...rows] = csvRows(text);
  const expected = VACANCY_HEADERS.map(normalizeHeader);
  const actual = (header ?? []).map(normalizeHeader);
  if (actual.length !== 3 || new Set(actual).size !== 3 || expected.some(value => !actual.includes(value))) {
    throw new Error(`CSV headers must be: ${VACANCY_HEADERS.join(", ")}.`);
  }
  if (!rows.length) throw new Error("The CSV has no vacancy rows.");
  const positions = expected.map(value => actual.indexOf(value));
  return rows.map((row, index) => {
    if (row.length !== 3) throw new Error(`Data row ${index + 1}: expected exactly three columns.`);
    const [company, title, rawCount] = positions.map(position => row[position].trim());
    const count = !rawCount || rawCount.toLowerCase() === "null" ? "1" : rawCount;
    if (!company || !title) throw new Error(`Data row ${index + 1}: company and vacancy title are required.`);
    if (company.length > 500 || title.length > 500) throw new Error(`Data row ${index + 1}: company and title must each be 500 characters or fewer.`);
    if (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 2147483647) {
      throw new Error(`Data row ${index + 1}: Number of Vacancies must be a positive whole number (up to 2147483647).`);
    }
    return { company_name: company, vacancy_title: title, number_of_vacancies: Number(count) };
  });
}
