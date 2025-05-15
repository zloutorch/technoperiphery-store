const fs = require('fs');
const path = require('path');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  WidthType,
  BorderStyle
} = require('docx');

function groupByOrder(data) {
  const grouped = {};
  data.forEach(item => {
    if (!grouped[item.id]) {
      grouped[item.id] = {
        user: item.name,
        email: item.email,
        created_at: item.created_at,
        total: item.total_price,
        products: {}
      };
    }
    const key = item.product_name;
    if (!grouped[item.id].products[key]) {
      grouped[item.id].products[key] = { name: item.product_name, price: item.price, quantity: 1 };
    } else {
      grouped[item.id].products[key].quantity++;
    }
  });
  return grouped;
}

async function generateReportDocx(data, from, to) {
  const grouped = groupByOrder(data);
  const children = [];

  const accent = '000000';
  const gray = 'f0f8ff';

  children.push(new Paragraph({
    children: [
      new TextRun({ text: '📘 Отчёт по заказам с ', color: accent, bold: true, size: 32 }),
      new TextRun({ text: from, color: accent, bold: true, size: 32 }),
      new TextRun({ text: ' по ', color: accent, bold: true, size: 32 }),
      new TextRun({ text: to, color: accent, bold: true, size: 32}),
    ],
    spacing: { after: 400 }
  }));

  Object.values(grouped).forEach(order => {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: '👤 Покупатель: ', bold: true, color: accent }),
        new TextRun({ text: `${order.user} (${order.email})`, italics: true })
      ],
      spacing: { after: 150 }
    }));

    const rows = [
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ text: 'Товар', bold: true })],
            shading: { fill: gray }
          }),
          new TableCell({
            children: [new Paragraph({ text: 'Цена', bold: true })],
            shading: { fill: gray }
          }),
          new TableCell({
            children: [new Paragraph({ text: 'Кол-во', bold: true })],
            shading: { fill: gray }
          }),
        ]
      }),
      ...Object.values(order.products).map(p => new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(p.name)] }),
          new TableCell({ children: [new Paragraph(`${parseFloat(p.price).toFixed(2)} ₽`)
        ]}),
          new TableCell({ children: [new Paragraph(`${p.quantity}`)] }),
        ]
      }))
    ];

    children.push(new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.LEFT,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
        left: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
      }
    }));

    children.push(new Paragraph({
      children: [
        new TextRun({ text: `💰 Итого: `, bold: true, color: accent }),
        new TextRun({ text: `${parseFloat(order.total).toFixed(2)} ₽`, bold: true })

      ],
      spacing: { before: 100, after: 300 }
    }));
  });

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const filePath = path.join(__dirname, 'Отчёт_по_заказам.docx');
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

module.exports = { generateReportDocx };
