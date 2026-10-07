import { NextRequest, NextResponse } from 'next/server'
import { getSession, getAdminScope, subscriptionExpiredResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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

    // Collect cotisations for the period
    const detailRows: (string | number)[][] = []
    const monthRows: (string | number)[][] = []
    let totalCotisations = 0
    let totalPaid = 0
    let totalUnpaid = 0

    for (const b of buildings) {
      const cotisations = await db.cotisation.findMany({
        where: {
          apartment: { buildingId: b.id },
          month: { gte: fromMonth, lte: toMonth },
          year,
        },
        include: {
          apartment: {
            include: {
              owner: { select: { name: true, email: true } },
            },
          },
        },
        orderBy: [{ month: 'asc' }, { apartment: { number: 'asc' } }],
      })

      for (const c of cotisations) {
        detailRows.push([
          monthNames[c.month - 1],
          `N° ${c.apartment.number}`,
          c.apartment.owner?.name || c.apartment.ownerName || '-',
          b.name,
          c.amount,
          c.isPaid ? 'Paye' : 'Non paye',
        ])
        totalCotisations += c.amount
        if (c.isPaid) {
          totalPaid += c.amount
        } else {
          totalUnpaid += c.amount
        }
      }
    }

    // Monthly summary
    for (let m = fromMonth; m <= toMonth; m++) {
      const monthCots = detailRows.filter((r, idx) => {
        // Match rows belonging to this month (rows were added in month order per building)
        return monthNames[m - 1] === r[0]
      })
      if (monthCots.length > 0) {
        const mTotal = monthCots.reduce((s, r) => s + (r[4] as number), 0)
        const mPaid = monthCots.filter(r => r[5] === 'Paye').reduce((s, r) => s + (r[4] as number), 0)
        monthRows.push([monthNames[m - 1], monthCots.length, mTotal, mPaid, mTotal - mPaid])
      }
    }

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
    doc.text('Rapport des Cotisations', 64, 12)

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
      { label: 'Total Cotisations', value: `${totalCotisations.toFixed(0)} MAD`, color: [37, 99, 235] },
      { label: 'Payees', value: `${totalPaid.toFixed(0)} MAD`, color: [13, 148, 136] },
      { label: 'Impayees', value: `${totalUnpaid.toFixed(0)} MAD`, color: [220, 38, 38] },
      { label: 'Taux recouvrement', value: totalCotisations > 0 ? `${Math.round((totalPaid / totalCotisations) * 100)}%` : '0%', color: [22, 163, 74] },
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

    y += cardH + 10

    // Monthly summary table
    if (monthRows.length > 0) {
      doc.setTextColor(37, 99, 235)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('Resume mensuel', 14, y)
      y += 4

      autoTable(doc, {
        startY: y,
        head: [['Mois', 'Nb cotisations', 'Total (MAD)', 'Paye (MAD)', 'Impaye (MAD)']],
        body: monthRows.map(r => [
          r[0] as string,
          String(r[1]),
          (r[2] as number).toFixed(0),
          (r[3] as number).toFixed(0),
          (r[4] as number).toFixed(0),
        ]),
        theme: 'plain',
        headStyles: {
          fillColor: [13, 148, 136],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        columnStyles: {
          0: { fontStyle: 'bold' },
          1: { halign: 'center' },
          2: { halign: 'right' },
          3: { halign: 'right', textColor: [13, 148, 136] },
          4: { halign: 'right', textColor: [220, 38, 38] },
        },
        bodyStyles: {
          fontSize: 8,
          textColor: [55, 65, 81],
        },
        alternateRowStyles: {
          fillColor: [240, 253, 250],
        },
        margin: { left: 14, right: 14 },
      })

      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12
    }

    // Detailed cotisations table
    if (detailRows.length > 0) {
      if (y > 140) {
        doc.addPage()
        y = 20
      }

      doc.setTextColor(37, 99, 235)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('Detail des cotisations', 14, y)
      y += 4

      autoTable(doc, {
        startY: y,
        head: [['Mois', 'Appartement', 'Proprietaire', 'Immeuble', 'Montant (MAD)', 'Statut']],
        body: detailRows.map(r => [
          r[0] as string,
          r[1] as string,
          r[2] as string,
          r[3] as string,
          (r[4] as number).toFixed(0),
          r[5] as string,
        ]),
        foot: [['', '', '', 'Total', totalCotisations.toFixed(0), `${totalPaid.toFixed(0)} payes`]],
        theme: 'plain',
        headStyles: {
          fillColor: [37, 99, 235],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        columnStyles: {
          0: { cellWidth: 26 },
          1: { cellWidth: 26 },
          2: { cellWidth: 55 },
          3: { cellWidth: 45 },
          4: { halign: 'right' },
          5: { halign: 'center' },
        },
        footStyles: {
          fillColor: [219, 234, 254],
          textColor: [31, 41, 55],
          fontStyle: 'bold',
          fontSize: 8,
        },
        bodyStyles: {
          fontSize: 7.5,
          textColor: [55, 65, 81],
        },
        alternateRowStyles: {
          fillColor: [249, 250, 251],
        },
        margin: { left: 14, right: 14 },
        didParseCell: (data: { section?: string; column?: { index?: number }; cell?: { styles?: { textColor?: number[]; fontStyle?: string } }; row?: { raw?: unknown[] } }) => {
          // Color statut column
          if (data.section === 'body' && data.column?.index === 5) {
            const statut = data.row?.raw?.[5] as string
            data.cell!.styles!.textColor = statut === 'Paye' ? [13, 148, 136] : [220, 38, 38]
            data.cell!.styles!.fontStyle = 'bold'
          }
        },
      })
    }

    // Footer
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setTextColor(156, 163, 175)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text(
        `SyndicPro - Rapport cotisations - Page ${i}/${pageCount} - ${new Date().toLocaleDateString('fr-FR')}`,
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
    const filename = `Cotisations_SyndicPro${buildingLabel}_${periodLabel}.pdf`

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch (error) {
    console.error('Cotisations PDF export error:', error)
    return NextResponse.json({ error: 'Erreur lors de la generation du PDF' }, { status: 500 })
  }
}
