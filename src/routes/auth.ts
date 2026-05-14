import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/User';
import { env } from '../config/env';
import { authenticate, AuthRequest } from '../middleware/authenticate';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    return;
  }

  const user = await UserModel.findOne({ username: username.toLowerCase().trim() });
  if (!user || !(await user.comparePassword(password))) {
    res.status(401).json({ error: 'Credenciales inválidas' });
    return;
  }

  const token = jwt.sign(
    { sub: user._id.toString(), username: user.username, role: user.role },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, user: { username: user.username, role: user.role } });
});

router.get('/me', authenticate, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

export default router;
