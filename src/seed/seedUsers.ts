import '../config/env';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { UserModel } from '../models/User';

async function seedUsers() {
  await mongoose.connect(env.MONGO_URI);

  const users = [
    { username: 'admin', password: env.ADMIN_PASSWORD, role: 'admin' as const },
    { username: 'cliente', password: env.CLIENT_PASSWORD, role: 'cliente' as const },
  ];

  for (const u of users) {
    const existing = await UserModel.findOne({ username: u.username });
    if (existing) {
      console.log(`[seed:users] "${u.username}" ya existe — omitido`);
      continue;
    }
    await UserModel.create(u);
    console.log(`[seed:users] "${u.username}" (${u.role}) creado`);
  }

  await mongoose.disconnect();
  console.log('[seed:users] listo');
}

seedUsers().catch((err) => {
  console.error(err);
  process.exit(1);
});
