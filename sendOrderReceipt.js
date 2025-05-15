const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun,
  Table, TableRow, TableCell, AlignmentType, WidthType
} = require('docx');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'technoperiphery@gmail.com',
    pass: 'kuphohwsjgsqagun' // Используй app-password
  }
});

async function sendOrderReceipt(user, order) {
  const logoPath = path.join(__dirname, 'logo.png');
  const logoImage = fs.readFileSync(logoPath);

  // Таблица товаров с количеством
  const tableRows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "Товар", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Цена", bold: true })] }),
      ]
    }),
    ...order.items.map(item =>
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(`${item.name} ×${item.quantity}`)] }),
          new TableCell({ children: [new Paragraph(`${(item.price * item.quantity).toFixed(2)} ₽`)] }),
        ]
      })
    )
  ];

  // Документ Word
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({ data: logoImage, transformation: { width: 100, height: 100 } })
          ]
        }),
        new Paragraph({
          text: "Квитанция заказа",
          heading: "Heading1",
          alignment: AlignmentType.CENTER
        }),
        new Paragraph(" "),
        new Paragraph(`Покупатель: ${user.name}`),
        new Paragraph(`Телефон: ${user.phone}`),
        new Paragraph(`Email: ${user.email}`),
        new Paragraph(`Дата: ${new Date().toLocaleString()}`),
        new Paragraph(" "),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }),
        new Paragraph(" "),
        new Paragraph({
          children: [new TextRun({ text: `Итого: ${order.total_price} ₽`, bold: true, color: "00c8ff" })]
        }),
        new Paragraph(" "),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: "Спасибо, что выбрали ТехноПериферию ",
              bold: true,
              color: "00c8ff"
            })
          ]
        })
      ]
    }]
  });

  // Сохраняем временный файл
  const buffer = await Packer.toBuffer(doc);
  const tempFile = path.join(__dirname, `receipt-${Date.now()}.docx`);
  fs.writeFileSync(tempFile, buffer);

  // Отправляем письмо
  await transporter.sendMail({
    from: '"TechnoPeriphery" <technoperiphery@gmail.com>',
    to: user.email,
    subject: '🧾 Электронный чек от TechnoPeriphery',
    html: `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2 style="color: #00c8ff;">Спасибо за заказ, ${user.name}!</h2>
        <p>Ваш чек находится во вложении.</p>
        <p>Если возникнут вопросы — напишите нам.</p>
        <hr>
        <p style="font-size: 13px; color: #777;">TechnoPeriphery — магазин, где технологии ближе.</p>
        <img src="cid:logo" style="width: 120px; margin-top: 10px;" alt="logo">
      </div>
    `,
    attachments: [
      {
        filename: 'Чек.docx',
        path: tempFile
      },
      {
        filename: 'logo.png',
        path: logoPath,
        cid: 'logo'
      }
    ]
  });

  // Удаляем временный файл
  fs.unlinkSync(tempFile);
}

module.exports = { sendOrderReceipt };
