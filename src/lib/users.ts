export type AppUser = {
  username: string;
  password: string;
  unlimited?: boolean;
  limit?: number;
  /** Nombre y apellido completos — usados en avatares, atribución y correos de apelación. */
  fullName?: string;
  /** Dirección de correo — usada solo para notificar restauraciones de cupo aprobadas. */
  email?: string;
  /** Único valor soportado hoy: "admin" habilita eliminar análisis en la Biblioteca y da comparaciones
   * ilimitadas. Se configura manualmente agregando este campo a la entrada del usuario en APP_USERS. */
  role?: "admin";
};

let cachedUsers: AppUser[] | null = null;

export function getUsers(): AppUser[] {
  if (cachedUsers) return cachedUsers;

  const raw = process.env.APP_USERS;
  if (!raw) {
    throw new Error("APP_USERS no está configurada en el servidor.");
  }

  const parsed = JSON.parse(raw) as AppUser[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("APP_USERS debe ser un arreglo JSON no vacío.");
  }

  cachedUsers = parsed;
  return parsed;
}

export function findUser(username: string): AppUser | undefined {
  return getUsers().find((u) => u.username === username);
}
