export type AppUser = {
  username: string;
  password: string;
  unlimited?: boolean;
  limit?: number;
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
