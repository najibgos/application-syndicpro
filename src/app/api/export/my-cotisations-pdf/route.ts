import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 })
    }
    if (session.role !== 'OWNER') {
      return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()))
    const fromMonth = parseInt(searchParams.get('fromMonth') || '1')
    const toMonth = parseInt(searchParams.get('toMonth') || '12')

    const monthNames = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre']
    const monthNamesFull = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

    // Find the owner's user info and apartment
    const user = await db.user.findUnique({ where: { id: session.userId } })
    const apartment = await db.apartment.findFirst({
      where: { userId: session.userId },
      include: { building: { select: { name: true, address: true, city: true } } },
    })

    if (!apartment) {
      return NextResponse.json({ error: 'Aucun appartement associe a votre compte' }, { status: 404 })
    }

    // Fetch the owner's cotisations for the period
    const cotisations = await db.cotisation.findMany({
      where: {
        apartmentId: apartment.id,
        month: { gte: fromMonth, lte: toMonth },
        year,
      },
      orderBy: { month: 'asc' },
    })

    let totalCotisations = 0
    let totalPaid = 0
    let totalUnpaid = 0

    const detailRows: (string | number)[][] = cotisations.map(c => {
      totalCotisations += c.amount
      if (c.isPaid) {
        totalPaid += c.amount
      } else {
        totalUnpaid += c.amount
      }
      return [
        monthNames[c.month - 1],
        `N° ${apartment.number}`,
        c.amount,
        c.isPaid ? 'Paye' : 'Non paye',
        c.validatedAt ? new Date(c.validatedAt).toLocaleDateString('fr-FR') : '-',
      ]
    })

    // Missing months (no cotisation record created yet)
    const existingMonths = new Set(cotisations.map(c => c.month))
    const missingMonths: string[] = []
    for (let m = fromMonth; m <= toMonth; m++) {
      if (!existingMonths.has(m)) missingMonths.push(monthNames[m - 1])
    }

    // Generate PDF (portrait A4)
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()

    // Header bar
    doc.setFillColor(37, 99, 235)
    doc.rect(0, 0, pageWidth, 30, 'F')

    doc.setTextColor(255, 255, 255)
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text('SyndicPro', 14, 13)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text('Releve de mes cotisations', 64, 13)

    doc.setFontSize(8)
    doc.setTextColor(219, 234, 254)
    doc.text(`Periode : ${monthNamesFull[fromMonth - 1]} - ${monthNamesFull[toMonth - 1]} ${year}`, 14, 21)
    doc.text(`Genere le : ${new Date().toLocaleDateString('fr-FR')}`, 14, 26)

    // Owner info block
    doc.setFillColor(239, 246, 255)
    doc.roundedRect(14, 36, pageWidth - 28, 22, 2, 2, 'F')
    doc.setTextColor(37, 99, 235)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(user?.name || 'Proprietaire', 18, 43)
    doc.setTextColor(55, 65, 81)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(
      `Appartement : N° ${apartment.number}   |   Immeuble : ${apartment.building.name}` +
      (apartment.building.city ? ` (${apartment.building.city})` : ''),
      18,
      49
    )
    doc.text(`Contact : ${user?.email || '-'}`, 18, 54)

    // Summary cards
    let y = 66
    const cards = [
      { label: 'Total Cotisations', value: `${totalCotisations.toFixed(0)} MAD`, color: [37, 99, 235] },
      { label: 'Payees', value: `${totalPaid.toFixed(0)} MAD`, color: [13, 148, 136] },
      { label: 'Impayees', value: `${totalUnpaid.toFixed(0)} MAD`, color: [220, 38, 38] },
      { label: 'Taux paiement', value: totalCotisations > 0 ? `${Math.round((totalPaid / totalCotisations) * 100)}%` : '0%', color: [22, 163, 74] },
    ]

    const cardW = (pageWidth - 28 - 15) / 4
    const cardH = 20
    const cardGap = 5

    cards.forEach((card, i) => {
      const cx = 14 + i * (cardW + cardGap)
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

    // Detailed cotisations table
    doc.setTextColor(37, 99, 235)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Detail de mes cotisations', 14, y)
    y += 4

    autoTable(doc, {
      startY: y,
      head: [['Mois', 'Appartement', 'Montant (MAD)', 'Statut', 'Paye le']],
      body: detailRows.map(r => [
        r[0] as string,
        r[1] as string,
        (r[2] as number).toFixed(0),
        r[3] as string,
        r[4] as string,
      ]),
      foot: [['Total', '', totalCotisations.toFixed(0), `${totalPaid.toFixed(0)} MAD payes`, '']],
      theme: 'plain',
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      columnStyles: {
        0: { cellWidth: 40, fontStyle: 'bold' },
        1: { cellWidth: 35 },
        2: { halign: 'right' },
        3: { halign: 'center' },
        4: { halign: 'center' },
      },
      footStyles: {
        fillColor: [219, 234, 254],
        textColor: [31, 41, 55],
        fontStyle: 'bold',
        fontSize: 8,
      },
      bodyStyles: {
        fontSize: 8.5,
        textColor: [55, 65, 81],
      },
      alternateRowStyles: {
        fillColor: [249, 250, 251],
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data: { section?: string; column?: { index?: number }; cell?: { styles?: { textColor?: number[]; fontStyle?: string } }; row?: { raw?: unknown[] } }) => {
        // Color statut column
        if (data.section === 'body' && data.column?.index === 3) {
          const statut = data.row?.raw?.[3] as string
          data.cell!.styles!.textColor = statut === 'Paye' ? [13, 148, 136] : [220, 38, 38]
          data.cell!.styles!.fontStyle = 'bold'
        }
      },
    })

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12

    // Missing months note
    if (missingMonths.length > 0) {
      if (y > 240) {
        doc.addPage()
        y = 20
      }
      doc.setFillColor(254, 242, 242)
      doc.roundedRect(14, y, pageWidth - 28, 14, 2, 2, 'F')
      doc.setTextColor(220, 38, 38)
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      doc.text('Mois sans cotisation enregistree :', 18, y + 6)
      doc.setFont('helvetica', 'normal')
      doc.text(missingMonths.join(', '), 18, y + 11)
    }

    // Footer
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setTextColor(156, 163, 175)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text(
        `SyndicPro - Releve personnel ${year} - Page ${i}/${pageCount} - ${new Date().toLocaleDateString('fr-FR')}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 8,
        { align: 'center' }
      )
    }

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'))

    const periodLabel = fromMonth === toMonth
      ? `${monthNames[fromMonth - 1]}_${year}`
      : `${monthNames[fromMonth - 1]}-${monthNames[toMonth - 1]}_${year}`
    const filename = `Mes_Cotisations_SyndicPro_${periodLabel}.pdf`

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch (error) {
    console.error('My cotisations PDF export error:', error)
    return NextResponse.json({ error: 'Erreur lors de la generation du PDF' }, { status: 500 })
  }
}
