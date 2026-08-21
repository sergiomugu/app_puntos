import { randomBytes } from "node:crypto";

// Se imprime sólo el valor para poder copiarlo directamente al gestor de
// secretos o al archivo de entorno protegido del servidor.
console.log(randomBytes(64).toString("base64url"));
