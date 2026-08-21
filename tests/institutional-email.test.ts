import assert from "node:assert/strict";
import test from "node:test";
import {
  isInstitutionalDomain,
  isInstitutionalEmail,
} from "../lib/server/institutional-email";

test("admite el dominio raíz y los subdominios institucionales UNRC", () => {
  for (const email of [
    "usuario@unrc.edu.ar",
    "usuario@ac.unrc.edu.ar",
    "usuario@eco.unrc.edu.ar",
    "usuario@exa.unrc.edu.ar",
    "usuario@ing.unrc.edu.ar",
    "usuario@sistemas.eco.unrc.edu.ar",
  ]) {
    assert.equal(isInstitutionalEmail(email), true, email);
  }
});

test("rechaza dominios externos, parecidos o con etiquetas inválidas", () => {
  for (const email of [
    "usuario@gmail.com",
    "usuario@falsaunrc.edu.ar",
    "usuario@unrc.edu.ar.otrodominio.com",
    "usuario@-eco.unrc.edu.ar",
    "usuario@eco-.unrc.edu.ar",
    "usuario@eco..unrc.edu.ar",
    "usuario@@eco.unrc.edu.ar",
  ]) {
    assert.equal(isInstitutionalEmail(email), false, email);
  }
});

test("valida el claim de organización Google por la misma jerarquía institucional", () => {
  assert.equal(isInstitutionalDomain("unrc.edu.ar"), true);
  assert.equal(isInstitutionalDomain("ac.unrc.edu.ar"), true);
  assert.equal(isInstitutionalDomain("eco.unrc.edu.ar"), true);
  assert.equal(isInstitutionalDomain("unrc.edu.ar.example"), false);
  assert.equal(isInstitutionalDomain("falsaunrc.edu.ar"), false);
});
