const express = require('express');
const axios = require('axios');
const cors = require('cors');
const db = require('./db');
require('dotenv').config();
const { sendOrderReceipt } = require('./sendOrderReceipt');
const { generateReportDocx } = require('./reportGenerator');
const { sendConfirmationEmail } = require('./mailer');

const app = express();
app.use(cors());
app.use(express.json());

// Проверка сервера
app.get('/', (_, res) => {
  res.send('Сервер работает!');
});

// Получить все товары
app.get('/products', async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM products');
    res.json(results);
  } catch (err) {
    console.error('Ошибка запроса:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить товар по ID
app.get('/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [results] = await db.query('SELECT * FROM products WHERE id = ?', [id]);
    if (results.length === 0) return res.status(404).json({ error: 'Товар не найден' });
    res.json(results[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Регистрация
app.post('/register', async (req, res) => {
  const { name, email, phone, password } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO users (name, email, phone, password, is_verified) VALUES (?, ?, ?, ?, 0)',
      [name, email, phone, password]
    );

    const newUser = { id: result.insertId, name, email, phone };

    axios.post('http://localhost:8000/notify', newUser).catch(console.error);

    res.json({ message: 'Регистрация прошла успешно. Ожидайте подтверждения от администратора.' });
  } catch (err) {
    console.error('Ошибка регистрации:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
app.post('/login', async (req, res) => {
  const { identifier, password } = req.body;
  try {
    const [results] = await db.query(
      'SELECT * FROM users WHERE (email = ? OR phone = ?) AND password = ?',
      [identifier, identifier, password]
    );

    if (results.length === 0) return res.status(401).json({ error: 'Неверные данные для входа' });

    const user = results[0];
    if (user.is_verified === 0)
      return res.status(403).json({ error: 'Аккаунт ещё не подтверждён администратором' });

    res.json({
      message: 'Успешный вход',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isAdmin: user.is_admin === 1,
        isVerified: user.is_verified === 1
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Оформить заказ
app.post('/orders', async (req, res) => {
  const { name, address, phone, comment, items, userId } = req.body;
  if (!userId) return res.status(401).json({ error: 'Авторизуйтесь' });

  const total = items.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0);

  try {
    const [result] = await db.query(
      'INSERT INTO orders (user_id, total_price, created_at) VALUES (?, ?, NOW())',
      [userId, total]
    );

    const orderId = result.insertId;
    const values = items.map(i => [orderId, i.id, i.quantity]);
    await db.query('INSERT INTO order_items (order_id, product_id, quantity) VALUES ?', [values]);

    // Обновление stock
    for (const item of items) {
      await db.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
    }

    const [productResults] = await db.query(
      'SELECT id, name FROM products WHERE id IN (?)',
      [items.map(i => i.id)]
    );

    const fullItems = items.map(i => ({
      ...i,
      name: productResults.find(p => p.id === i.id)?.name || '—'
    }));

    const [userResults] = await db.query(
      'SELECT name, email, phone FROM users WHERE id = ?',
      [userId]
    );

    if (userResults.length > 0) {
      await sendOrderReceipt(userResults[0], { items: fullItems, total_price: total });
    }

    res.json({ message: 'Заказ успешно оформлен', orderId });
  } catch (err) {
    console.error('Ошибка оформления заказа:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Заказы пользователя
app.get('/orders/user/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const [results] = await db.query(`
      SELECT o.id, o.total_price, o.created_at, o.delivery_status,
             p.name, p.price, p.image_url, oi.quantity
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
    `, [userId]);

    const grouped = {};
    results.forEach(row => {
      if (!grouped[row.id]) {
        grouped[row.id] = {
          id: row.id,
          total_price: row.total_price,
          created_at: row.created_at,
          delivery_status: row.delivery_status,
          items: []
        };
      }
      grouped[row.id].items.push({
        name: row.name,
        price: row.price,
        image_url: row.image_url,
        quantity: row.quantity
      });
    });

    res.json(Object.values(grouped));
  } catch (err) {
    console.error('Ошибка получения заказов:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удаление заказа
app.delete('/orders/:orderId', async (req, res) => {
  const { orderId } = req.params;
  try {
    await db.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
    await db.query('DELETE FROM orders WHERE id = ?', [orderId]);
    res.json({ message: 'Заказ удалён' });
  } catch (err) {
    console.error('Ошибка удаления заказа:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
// Получить всех пользователей
app.get('/api/admin/users', async (_, res) => {
  try {
    const [results] = await db.query('SELECT id, name, email, phone, is_verified FROM users');
    res.json(results);
  } catch (err) {
    console.error('Ошибка получения пользователей:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Подтвердить пользователя
app.post('/api/admin/verify-user/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [users] = await db.query('SELECT email, name FROM users WHERE id = ?', [id]);
    if (users.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });

    await db.query('UPDATE users SET is_verified = 1 WHERE id = ?', [id]);
    res.json({ message: 'Пользователь подтверждён' });

    // отправка письма отдельно
    sendConfirmationEmail(users[0].email, users[0].name)
      .then(() => console.log('Письмо отправлено'))
      .catch(err => console.error('Ошибка отправки письма:', err.message));
  } catch (err) {
    console.error('Ошибка подтверждения пользователя:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить пользователя
app.delete('/api/admin/delete-user/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'Пользователь удалён' });
  } catch (err) {
    console.error('Ошибка удаления пользователя:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить все заказы
app.get('/api/admin/orders', async (_, res) => {
  try {
    const [orders] = await db.query(`
      SELECT o.id, o.total_price, o.created_at, o.delivery_status, u.email AS user_email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `);

    if (!orders.length) return res.json([]);

    const orderIds = orders.map(o => o.id);
    const [items] = await db.query(`
      SELECT oi.order_id, p.name, p.price
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id IN (?)
    `, [orderIds]);

    const grouped = {};
    items.forEach(i => {
      if (!grouped[i.order_id]) grouped[i.order_id] = [];
      grouped[i.order_id].push({ name: i.name, price: i.price });
    });

    const combined = orders.map(o => ({
      ...o,
      products: grouped[o.id] || []
    }));

    res.json(combined);
  } catch (err) {
    console.error('Ошибка получения заказов:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Изменить статус доставки
app.post('/api/admin/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await db.query('UPDATE orders SET delivery_status = ? WHERE id = ?', [status, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка изменения статуса:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить список товаров
app.get('/api/admin/products', async (_, res) => {
  try {
    const [results] = await db.query(
      'SELECT id, name, price, category, description, image_url, stock FROM products'
    );
    res.json(results);
  } catch (err) {
    console.error('Ошибка получения товаров:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Добавить товар
app.post('/api/admin/add-product', async (req, res) => {
  const { name, price, description, category, image_url, stock } = req.body;
  try {
    await db.query(`
      INSERT INTO products (name, price, description, category, image_url, stock)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name, price, description, category, image_url, stock || 0]);
    res.json({ message: 'Товар успешно добавлен' });
  } catch (err) {
    console.error('Ошибка добавления товара:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить товар
app.delete('/api/admin/product/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM products WHERE id = ?', [id]);
    res.json({ message: 'Товар удалён' });
  } catch (err) {
    console.error('Ошибка удаления товара:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Редактировать товар
app.put('/api/admin/product/:id', async (req, res) => {
  const { id } = req.params;
  const { name, price, description, category, image_url, stock } = req.body;
  try {
    await db.query(`
      UPDATE products
      SET name = ?, price = ?, description = ?, category = ?, image_url = ?, stock = ?
      WHERE id = ?
    `, [name, price, description, category, image_url, stock || 0, id]);
    res.json({ message: 'Товар успешно обновлён' });
  } catch (err) {
    console.error('Ошибка обновления товара:', err.message);
    res.status(500).json({ error: 'Ошибка при обновлении товара' });
  }
});

// Отправить чек
app.post('/api/admin/send-check/:orderId', async (req, res) => {
  const { orderId } = req.params;
  try {
    const [results] = await db.query(`
      SELECT o.total_price, o.created_at, u.name, u.email, u.phone,
             p.name AS product_name, p.price
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.id = ?
    `, [orderId]);

    if (!results.length) return res.status(404).json({ error: 'Заказ не найден' });

    const user = {
      name: results[0].name,
      email: results[0].email,
      phone: results[0].phone
    };

    const order = {
      items: results.map(r => ({ name: r.product_name, price: r.price })),
      total_price: results[0].total_price
    };

    await sendOrderReceipt(user, order);
    res.json({ message: 'Чек успешно отправлен' });
  } catch (err) {
    console.error('Ошибка отправки чека:', err.message);
    res.status(500).json({ error: 'Ошибка при отправке письма' });
  }
});


// Сформировать отчёт
app.post('/api/admin/generate-report', async (req, res) => {
  const { from, to, status } = req.body;

  try {
    let query = `
      SELECT o.id, o.created_at, o.total_price, u.name, u.email, p.name AS product_name, p.price
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.created_at BETWEEN ? AND ?
    `;

    const params = [from, to];

    if (status) {
      query += ` AND o.delivery_status = ?`;
      params.push(status);
    }

    query += ` ORDER BY o.created_at DESC`;

    const [results] = await db.query(query, params);

    if (!results.length) {
      return res.status(404).json({ error: 'Нет заказов за указанный период' });
    }

    const filePath = await generateReportDocx(results, from, to);
    res.download(filePath, 'Отчёт_по_заказам.docx');
  } catch (err) {
    console.error('Ошибка генерации отчёта:', err.message);
    res.status(500).json({ error: 'Не удалось сгенерировать отчёт' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
