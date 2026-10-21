import test from "node:test";
import assert from "node:assert/strict";
import { parseVacanciesCsv, VACANCY_HEADERS } from "../src/lib/vacanciesCsv.js";

const header = VACANCY_HEADERS.join(",");

test("accepts user headers, BOM, CRLF, reordered columns and extra header whitespace", () => {
  assert.deepEqual(parseVacanciesCsv('\uFEFFNumber of  Vacancies,Company Name,Vacancy Title/ Position\r\n3,Acme,Clerk\r\n'), [
    { company_name: "Acme", vacancy_title: "Clerk", number_of_vacancies: 3 },
  ]);
});

test("preserves quoted commas, escaped quotes and multiline titles", () => {
  assert.deepEqual(parseVacanciesCsv(`${header}\n"Acme, Inc.","Senior ""Sales""\nAssociate",2`), [
    { company_name: "Acme, Inc.", vacancy_title: 'Senior "Sales"\nAssociate', number_of_vacancies: 2 },
  ]);
});

test("rejects invalid counts and missing required values", () => {
  for (const count of ["0", "-1", "1.5", "1e3", "2147483648", "NaN"]) {
    assert.throws(() => parseVacanciesCsv(`${header}\nAcme,Clerk,${count}`), /positive whole number/);
  }
  assert.throws(() => parseVacanciesCsv(`${header}\n,Clerk,2`), /required/);
});

test("defaults blank and null vacancy counts to one", () => {
  for (const count of ["", "   ", "null", "NULL"]) {
    assert.equal(parseVacanciesCsv(`${header}\nAcme,Clerk,${count}`)[0].number_of_vacancies, 1);
  }
});

test("rejects malformed CSV and incorrect headers before importing", () => {
  for (const csv of ["Company,Title,Count\nAcme,Clerk,1", `${header}\nAcme,Clerk,1,extra`, `${header}\n"Acme,Clerk,1`, `${header}\n"Acme"oops,Clerk,1`]) {
    assert.throws(() => parseVacanciesCsv(csv));
  }
  assert.throws(() => parseVacanciesCsv(header), /no vacancy rows/);
});

test("supports the row limit and rejects oversized imports", () => {
  assert.equal(parseVacanciesCsv(`${header}\n${"Acme,Clerk,1\n".repeat(5000)}`).length, 5000);
  assert.throws(() => parseVacanciesCsv(`${header}\n${"Acme,Clerk,1\n".repeat(5001)}`), /at most 5000/);
});
