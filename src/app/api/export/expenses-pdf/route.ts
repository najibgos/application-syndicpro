import { NextRequest, NextResponse } from 'next/server'
import { getSession, getAdminScope, subscriptionExpiredResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const CATEGORY_LABELS: Record<string, string> = {
  MENAGE: 'Femme de menage',
  SANITAIRE: 'Produits sanitaires',
  MAINTENANCE: 'Maintenance',
  AUTRE: 'Autre',
}

const CATEGORY_COLORS: Record<string, [number, number, number]> = {
  MENAGE: [147, 51, 234],      // purple
  SANITAIRE: [37, 99, 235],    // blue
  MAINTENANCE: [249, 115, 22], // orange
  AUTRE: [107, 114, 128],      // gray
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 })
    }
    const scope = await getAdminScope(session)
    if (!scope?.isAdmin) {
      return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })
    }
    if (!scope.subscriptionActive) {
      return subscriptionExpiredResponse()
    }

    const { searchParams } = new URL(request.url)
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()))
    const fromMonth = parseInt(searchParams.get('fromMonth') || '1')
    const toMonth = parseInt(searchParams.get('toMonth') || '12')
    // Building admin: force their own building
    const buildingId = scope.buildingId || searchParams.get('buildingId') || ''

    const monthNames = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre']
    const monthNamesFull = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

    // Get buildings
    let buildings = await db.building.findMany({ orderBy: { name: 'asc' } })
    if (buildingId) {
      buildings = buildings.filter(b => b.id === buildingId)
    }

    // Collect expenses for the period
    const expenseRows: (string | number)[][] = []
    const cleaningRows: (string | number)[][] = []
    let totalExpenses = 0
    let totalCleaning = 0
    const categoryTotals: Record<string, number> = { MENAGE: 0, SANITAIRE: 0, MAINTENANCE: 0, AUTRE: 0 }

    for (const b of buildings) {
      // Regular expenses
      const expenses = await db.expense.findMany({
        where: {
          buildingId: b.id,
          month: { gte: fromMonth, lte: toMonth },
          year,
        },
        orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
      })

      for (const exp of expenses) {
        expenseRows.push([
          monthNames[exp.month - 1],
          b.name,
          exp.description,
          CATEGORY_LABELS[exp.category] || exp.category,
          exp.amount,
        ])
        totalExpenses += exp.amount
        categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + exp.amount
      }

      // Cleaning fees
      const cleaningFees = await db.cleaningFee.findMany({
        where: {
          buildingId: b.id,
          month: { gte: fromMonth, lte: toMonth },
          year,
        },
        orderBy: [{ month: 'asc' }],
      })

      for (const cf of cleaningFees) {
        cleaningRows.push([
          monthNames[cf.month - 1],
          b.name,
          cf.amount,
        ])
        totalCleaning += cf.amount
        categoryTotals.MENAGE = (categoryTotals.MENAGE || 0) + cf.amount
      }
    }

    const grandTotal = totalExpenses + totalCleaning

    // Generate PDF
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()

    // Header bar
    doc.setFillColor(37, 99, 235)
    doc.rect(0, 0, pageWidth, 28, 'F')

    doc.setTextColor(255, 255, 255)
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text('SyndicPro', 14, 12)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text('Rapport Detaille des Depenses', 64, 12)

    doc.setFontSize(8)
    doc.setTextColor(219, 234, 254)
    const periodText = `Periode : ${monthNamesFull[fromMonth - 1]} - ${monthNamesFull[toMonth - 1]} ${year}`
    const buildingText = buildings.length === 1
      ? `Immeuble : ${buildings[0].name}`
      : `Immeubles : Tous (${buildings.length})`
    const dateText = `Genere le : ${new Date().toLocaleDateString('fr-FR')}`
    doc.text(periodText, 14, 20)
    doc.text(buildingText, 100, 20)
    doc.text(dateText, 200, 20)

    // Summary cards
    let y = 36
    const cards = [
      { label: 'Depenses', value: `${totalExpenses.toFixed(0)} MAD`, color: [249, 115, 22] },
      { label: 'Frais menage', value: `${totalCleaning.toFixed(0)} MAD`, color: [147, 51, 234] },
      { label: 'Total General', value: `${grandTotal.toFixed(0)} MAD`, color: [37, 99, 235] },
    ]

    const cardW = 42
    const cardH = 20
    const cardGap = 5
    const startX = 14

    cards.forEach((card, i) => {
      const cx = startX + i * (cardW + cardGap)
      doc.setFillColor(243, 244, 246)
      doc.roundedRect(cx, y, cardW, cardH, 2, 2, 'F')
      doc.setFillColor(card.color[0], card.color[1], card.color[2])
      doc.rect(cx, y, cardW, 1.5, 'F')
      doc.setTextColor(107, 114, 128)
      doc.setFontSize(6.5)
      doc.setFont('helvetica', 'normal')
      doc.text(card.label, cx + 3, y + 6)
      doc.setTextColor(31, 41, 55)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text(card.value, cx + 3, y + 14)
    })

    // Category breakdown
    const catX = startX + 3 * (cardW + cardGap) + 10
    doc.setTextColor(31, 41, 55)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.text('Repartition par categorie :', catX, y + 4)

    let catY = y + 9
    Object.entries(categoryTotals).forEach(([cat, total]) => {
      if (total > 0) {
        const color = CATEGORY_COLORS[cat] || [107, 114, 128]
        doc.setFillColor(color[0], color[1], color[2])
        doc.roundedRect(catX, catY - 2.5, 3, 3, 0.5, 0.5, 'F')
        doc.setTextColor(55, 65, 81)
        doc.setFontSize(7)
        doc.setFont('helvetica', 'normal')
        doc.text(`${CATEGORY_LABELS[cat]} : ${total.toFixed(0)} MAD`, catX + 5, catY)
        catY += 5
      }
    })

    y += cardH + 10

    // Expenses table
    if (expenseRows.length > 0) {
      doc.setTextColor(37, 99, 235)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('Depenses par categorie', 14, y)
      y += 4

      autoTable(doc, {
        startY: y,
        head: [['Mois', 'Immeuble', 'Description', 'Categorie', 'Montant (MAD)']],
        body: expenseRows.map(r => [
          r[0] as string,
          r[1] as string,
          r[2] as string,
          r[3] as string,
          (r[4] as number).toFixed(0),
        ]),
        foot: [['', '', '', 'Total depenses', totalExpenses.toFixed(0)]],
        theme: 'plain',
        headStyles: {
          fillColor: [249, 115, 22],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 35 },
          2: { cellWidth: 80 },
          3: { cellWidth: 35 },
          4: { halign: 'right', fontStyle: 'bold' },
        },
        footStyles: {
          fillColor: [254, 243, 199],
          textColor: [31, 41, 55],
          fontStyle: 'bold',
          fontSize: 8,
        },
        bodyStyles: {
          fontSize: 7.5,
          textColor: [55, 65, 81],
        },
        alternateRowStyles: {
          fillColor: [255, 247, 237],
        },
        margin: { left: 14, right: 14 },
        didParseCell: (data: { section?: string; column?: { index?: number }; cell?: { styles?: { textColor?: number[]; fillColor?: number[] } }; row?: { raw?: unknown[] } }) => {
          // Color category column
          if (data.section === 'body' && data.column?.index === 3) {
            const catValue = data.row?.raw?.[3] as string
            const catKey = Object.entries(CATEGORY_LABELS).find(([, v]) => v === catValue)?.[0]
            if (catKey) {
              const color = CATEGORY_COLORS[catKey]
              if (color) {
                data.cell!.styles!.textColor = color
              }
            }
          }
        },
      })

      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12
    }

    // Cleaning fees table
    if (cleaningRows.length > 0) {
      if (y > 170) {
        doc.addPage()
        y = 20
      }

      doc.setTextColor(147, 51, 234)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('Frais femme de menage', 14, y)
      y += 4

      autoTable(doc, {
        startY: y,
        head: [['Mois', 'Immeuble', 'Montant (MAD)']],
        body: cleaningRows.map(r => [
          r[0] as string,
          r[1] as string,
          (r[2] as number).toFixed(0),
        ]),
        foot: [['', 'Total frais menage', totalCleaning.toFixed(0)]],
        theme: 'plain',
        headStyles: {
          fillColor: [147, 51, 234],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        columnStyles: {
          0: { cellWidth: 35 },
          1: { cellWidth: 50 },
          2: { halign: 'right', fontStyle: 'bold' },
        },
        footStyles: {
          fillColor: [243, 232, 255],
          textColor: [31, 41, 55],
          fontStyle: 'bold',
          fontSize: 8,
        },
        bodyStyles: {
          fontSize: 7.5,
          textColor: [55, 65, 81],
        },
        alternateRowStyles: {
          fillColor: [250, 245, 255],
        },
        margin: { left: 14, right: 14 },
      })

      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12
    }

    // Grand total section
    if (y > 170) {
      doc.addPage()
      y = 20
    }

    doc.setFillColor(37, 99, 235)
    doc.roundedRect(14, y, pageWidth - 28, 14, 2, 2, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(`TOTAL GENERAL DES DEPENSES : ${grandTotal.toFixed(0)} MAD`, 20, y + 9)

    // Footer
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setTextColor(156, 163, 175)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text(
        `SyndicPro - Rapport depenses - Page ${i}/${pageCount} - ${new Date().toLocaleDateString('fr-FR')}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 8,
        { align: 'center' }
      )
    }

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'))

    const periodLabel = fromMonth === toMonth
      ? `${monthNames[fromMonth - 1]}_${year}`
      : `${monthNames[fromMonth - 1]}-${monthNames[toMonth - 1]}_${year}`
    const buildingLabel = buildings.length === 1 ? `_${buildings[0].name.replace(/\s+/g, '_')}` : ''
    const filename = `Depenses_SyndicPro${buildingLabel}_${periodLabel}.pdf`

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch (error) {
    console.error('Expenses PDF export error:', error)
    return NextResponse.json({ error: 'Erreur lors de la generation du PDF' }, { status: 500 })
  }
}
