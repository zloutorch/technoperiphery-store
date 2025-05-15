const express = require('express');
const axios = require('axios');
const cors = require('cors');
const db = require('./db');
require('dotenv').config();
const { sendOrderReceipt } = require('./sendOrderReceipt');
const { generateReportDocx } = require('./reportGenerator');
const { sendConfirmationEmail } = require('./mailer'); // путь зависит от расположения


const app = express();
app.use(cors());
app.use(express.json());

// Проверка сервера
app.get('/', (req, res) => {
  res.send('Сервер работает!');
});

// Получить все товары
app.get('/products', (req, res) => {
  db.query('SELECT * FROM products', (err, results) => {
    if (err) {
      console.log('Ошибка запроса:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    res.json(results);
  });
});
// Оформить заказ
app.post('/orders', (req, res) => {
  const { name, address, phone, comment, items, userId } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Только авторизованные пользователи могут оформлять заказы.' });
  }

  const total = items.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);

  const insertOrderQuery = `INSERT INTO orders (user_id, total_price, created_at) VALUES (?, ?, NOW())`;

  db.query(insertOrderQuery, [userId, total], (err, result) => {
    if (err) {
      console.error('Ошибка добавления заказа:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера при создании заказа' });
    }

    const orderId = result.insertId;
    const values = items.map(item => [orderId, item.id, item.quantity]);

    db.query(`INSERT INTO order_items (order_id, product_id, quantity) VALUES ?`, [values], (err) => {
      if (err) {
        console.error('Ошибка добавления товаров:', err.message);
        return res.status(500).json({ error: 'Ошибка сервера при добавлении товаров' });
      }

      // Уменьшаем количество на складе
      items.forEach(item => {
        db.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id], (err) => {
          if (err) console.error(`Ошибка обновления stock для товара ${item.id}:`, err.message);
        });
      });

      // Получаем полные названия товаров из БД
      const productIds = items.map(i => i.id);
      db.query('SELECT id, name FROM products WHERE id IN (?)', [productIds], (err2, productResults) => {
        if (err2) {
          console.error('Ошибка получения названий товаров:', err2.message);
          return res.status(500).json({ error: 'Ошибка при получении названий товаров' });
        }

        // Склеиваем данные
        const fullItems = items.map(item => {
          const match = productResults.find(p => p.id === item.id);
          return {
            ...item,
            name: match?.name || '—'
          };
        });

        // Получаем данные пользователя
        db.query('SELECT name, email, phone FROM users WHERE id = ?', [userId], async (err3, results) => {
          if (!err3 && results.length > 0) {
            const user = results[0];
            try {
              await sendOrderReceipt(user, { items: fullItems, total_price: total });
              console.log('✅ Чек отправлен на почту');
            } catch (e) {
              console.error('❌ Ошибка отправки чека:', e.message);
            }
          }
        });

        res.json({ message: 'Заказ успешно оформлен', orderId });
      });
    });
  });
});

// Получить заказы конкретного пользователя
app.get('/orders/user/:userId', (req, res) => {
  const userId = req.params.userId;

  const ordersQuery = `
   SELECT o.id, o.total_price, o.created_at, o.delivery_status,
       p.name, p.price, p.image_url, oi.quantity

FROM orders o
JOIN order_items oi ON o.id = oi.order_id
JOIN products p ON oi.product_id = p.id
WHERE o.user_id = ?
ORDER BY o.created_at DESC

  `;

  db.query(ordersQuery, [userId], (err, results) => {
    if (err) {
      console.error('Ошибка при получении заказов:', err.message);
      return res.status(500).json({ error: 'Ошибка при загрузке заказов' });
    }

    // Группируем заказы по id
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
      grouped[row.id].items.push({ name: row.name, price: row.price, image_url: row.image_url, quantity: row.quantity });

    });

    res.json(Object.values(grouped));
  });
});
// Удалить один заказ по ID
app.delete('/orders/:orderId', (req, res) => {
  const orderId = req.params.orderId;

  const deleteItemsQuery = 'DELETE FROM order_items WHERE order_id = ?';
  db.query(deleteItemsQuery, [orderId], (err) => {
    if (err) {
      console.error('Ошибка при удалении товаров заказа:', err.message);
      return res.status(500).json({ error: 'Ошибка при удалении товаров' });
    }

    const deleteOrderQuery = 'DELETE FROM orders WHERE id = ?';
    db.query(deleteOrderQuery, [orderId], (err) => {
      if (err) {
        console.error('Ошибка при удалении заказа:', err.message);
        return res.status(500).json({ error: 'Ошибка при удалении заказа' });
      }

      res.json({ message: 'Заказ удалён' });
    });
  });
});
app.get('/products/:id', (req, res) => {
  const productId = req.params.id;
  db.query('SELECT * FROM products WHERE id = ?', [productId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (results.length === 0) return res.status(404).json({ error: 'Товар не найден' });
    res.json(results[0]);
  });
});



const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
app.post('/register', (req, res) => {
  const { name, email, phone, password } = req.body;

  const query = 'INSERT INTO users (name, email, phone, password, is_verified) VALUES (?, ?, ?, ?, 0)';
  db.query(query, [name, email, phone, password], (err, result) => {
    if (err) {
      console.error('Ошибка регистрации:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    const newUser = {
      id: result.insertId,
      name,
      email,
      phone
    };
  
    axios.post('http://localhost:8000/notify', newUser)
      .catch(err => {
        console.error('Ошибка отправки уведомления в Telegram:', err.message);
      });
  
    res.json({ message: 'Регистрация прошла успешно. Ожидайте подтверждения от администратора.' });
  });
});
app.post('/login', (req, res) => {
  const { identifier, password } = req.body;

  const query = 'SELECT * FROM users WHERE (email = ? OR phone = ?) AND password = ?';
  db.query(query, [identifier, identifier, password], (err, results) => {
    if (err) {
      console.error('Ошибка входа:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    if (results.length === 0) {
      return res.status(401).json({ error: 'Неверные данные для входа' });
    }

    const user = results[0];

    // Добавляем проверку подтверждения
    if (user.is_verified === 0) {
      return res.status(403).json({ error: 'Аккаунт ещё не подтверждён администратором' });
    }

    // Отправляем все необходимые поля на фронт
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
  });
});


app.get('/api/admin/users', (req, res) => {
  db.query('SELECT id, name, email, phone, is_verified FROM users', (err, results) => {
    if (err) {
      console.error('Ошибка получения пользователей:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    res.json(results);
  });
});
app.post('/api/admin/verify-user/:id', (req, res) => {
  const userId = req.params.id;

  db.query('SELECT email, name FROM users WHERE id = ?', [userId], (err, results) => {
    if (err || results.length === 0) {
      console.error('Ошибка получения пользователя:', err?.message);
      return res.status(500).json({ error: 'Пользователь не найден' });
    }

    const user = results[0];

    db.query('UPDATE users SET is_verified = 1 WHERE id = ?', [userId], (err) => {
      if (err) {
        console.error('Ошибка подтверждения пользователя:', err.message);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }

      // ✅ Сразу отправляем клиенту ответ
      res.json({ message: 'Пользователь подтверждён' });

      // 📧 А письмо отправляем уже отдельно — не блокируем
      sendConfirmationEmail(user.email, user.name)
        .then(() => console.log('Письмо отправлено'))
        .catch(err => console.error('Ошибка отправки письма:', err.message));
    });
  });
});


app.delete('/api/admin/delete-user/:id', (req, res) => {
  const userId = req.params.id;
  db.query('DELETE FROM users WHERE id = ?', [userId], (err) => {
    if (err) {
      console.error('Ошибка удаления пользователя:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    res.json({ message: 'Пользователь удалён' });
  });
});

app.get('/api/admin/orders', (req, res) => {
  const query = `
    SELECT o.id, o.total_price, o.created_at, o.delivery_status, u.email AS user_email
    FROM orders o
    JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC
  `;

  db.query(query, (err, orders) => {
    if (err) {
      console.error('Ошибка получения заказов:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }

    // Теперь подтянем товары в заказах
    const orderIds = orders.map(o => o.id);
    if (orderIds.length === 0) return res.json([]); // если заказов нет

    const itemsQuery = `
      SELECT oi.order_id, p.name, p.price
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id IN (?)
    `;

    db.query(itemsQuery, [orderIds], (err, items) => {
      if (err) {
        console.error('Ошибка получения товаров в заказах:', err.message);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }

      // группируем товары по заказам
      const groupedItems = {};
      items.forEach(item => {
        if (!groupedItems[item.order_id]) {
          groupedItems[item.order_id] = [];
        }
        groupedItems[item.order_id].push({ name: item.name, price: item.price });
      });

      // соединяем заказы с товарами
      const ordersWithItems = orders.map(order => ({
        ...order,
        products: groupedItems[order.id] || []
      }));

      res.json(ordersWithItems);
    });
  });
});
app.post('/api/admin/orders/:id/status', (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;

  db.query('UPDATE orders SET delivery_status = ? WHERE id = ?', [status, orderId], (err) => {
    if (err) {
      console.error('Ошибка обновления статуса доставки:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    res.json({ success: true });
  });
});

app.get('/api/admin/products', (req, res) => {
  db.query('SELECT id, name, price, category, description, image_url, stock FROM products', (err, results) => {
    if (err) {
      console.error('Ошибка получения товаров:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    res.json(results);
  });
});

app.post('/api/admin/add-product', (req, res) => {
  const { name, price, description, category, image_url, stock} = req.body;

  const query = `
    INSERT INTO products (name, price, description, category, image_url, stock)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.query(query, [name, price, description, category, image_url, stock || 0], (err) => {
    if (err) {
      console.error('Ошибка добавления товара:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    res.json({ message: 'Товар успешно добавлен' });
  });
});

app.delete('/api/admin/product/:id', (req, res) => {
  const productId = req.params.id;
  db.query('DELETE FROM products WHERE id = ?', [productId], (err) => {
    if (err) {
      console.error('Ошибка удаления товара:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    res.json({ message: 'Товар удалён' });
  });
});
app.put('/api/admin/product/:id', (req, res) => {
  const productId = req.params.id;
  const { name, price, description, category, image_url, stock } = req.body;

  const query = `
    UPDATE products
    SET name = ?, price = ?, description = ?, category = ?, image_url = ?, stock = ?
    WHERE id = ?
  `;

  db.query(query, [name, price, description, category, image_url,, stock || 0, productId], (err, result) => {
    if (err) {
      console.error('Ошибка обновления товара:', err.message);
      return res.status(500).json({ error: 'Ошибка при обновлении товара' });
    }

    res.json({ message: 'Товар успешно обновлён' });
  });
});

app.post('/api/admin/send-check/:orderId', (req, res) => {
  const orderId = req.params.orderId;

  const query = `
    SELECT o.total_price, o.created_at, u.name, u.email, u.phone,
           p.name AS product_name, p.price
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN order_items oi ON o.id = oi.order_id
    JOIN products p ON oi.product_id = p.id
    WHERE o.id = ?
  `;

  db.query(query, [orderId], async (err, results) => {
    if (err || results.length === 0) {
      console.error('Ошибка получения данных заказа:', err?.message);
      return res.status(500).json({ error: 'Ошибка при получении заказа' });
    }

    const user = {
      name: results[0].name,
      email: results[0].email,
      phone: results[0].phone
    };

    const order = {
      items: results.map(r => ({ name: r.product_name, price: r.price })),
      total_price: results[0].total_price
    };

    try {
      await sendOrderReceipt(user, order);
      res.json({ message: 'Чек успешно отправлен' });
    } catch (e) {
      console.error('Ошибка отправки чека:', e.message);
      res.status(500).json({ error: 'Ошибка при отправке письма' });
    }
  });
});
app.post('/api/admin/generate-report', (req, res) => {
  const { from, to } = req.body;
  console.log('⏱️ Даты отчёта:', from, to);

  const query = `
    SELECT o.id, o.created_at, o.total_price, u.name, u.email, p.name AS product_name, p.price
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN order_items oi ON o.id = oi.order_id
    JOIN products p ON oi.product_id = p.id
    WHERE o.created_at BETWEEN ? AND ?
    ORDER BY o.created_at DESC
  `;

  db.query(query, [from, to], async (err, results) => {
   if (err) {
  console.error('❌ SQL ошибка:', err);
  return res.status(500).json({ error: 'Ошибка получения заказов для отчёта' });
}
if (results.length === 0) {
  console.log('⚠️ Нет заказов за выбранный период.');
  return res.status(404).json({ error: 'Нет заказов за указанный период' });
}


    try {
      const filePath = await generateReportDocx(results, from, to);
      res.download(filePath, 'Отчёт_по_заказам.docx');
    } catch (e) {
      console.error('Ошибка генерации отчёта:', e.message);
      res.status(500).json({ error: 'Не удалось сгенерировать отчёт' });
    }
  });
});