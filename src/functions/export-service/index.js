const { Parser } = require('@json2csv/plainjs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

module.exports = async function (context, req) {
    context.log('Export Service function processing request');
    
    // Handle CORS
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: ''
        };
        return;
    }

    const format = req.params.format?.toLowerCase();
    const { data, metadata, options } = req.body;

    if (!data) {
        context.res = {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: { error: 'No data provided for export' }
        };
        return;
    }

    try {
        let result;
        let contentType;
        let fileName;

        switch (format) {
            case 'csv':
                result = await exportToCSV(data, options);
                contentType = 'text/csv';
                fileName = `export-${Date.now()}.csv`;
                break;

            case 'excel':
            case 'xlsx':
                result = await exportToExcel(data, metadata, options);
                contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                fileName = `export-${Date.now()}.xlsx`;
                break;

            case 'pdf':
                result = await exportToPDF(data, metadata, options);
                contentType = 'application/pdf';
                fileName = `export-${Date.now()}.pdf`;
                break;

            case 'json':
                result = JSON.stringify(data, null, 2);
                contentType = 'application/json';
                fileName = `export-${Date.now()}.json`;
                break;

            case 'txt':
            case 'text':
                result = await exportToText(data, metadata, options);
                contentType = 'text/plain';
                fileName = `export-${Date.now()}.txt`;
                break;

            default:
                context.res = {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: { error: `Unsupported format: ${format}` }
                };
                return;
        }

        // Return the exported data
        context.res = {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${options?.filename || fileName}"`,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: result,
            isRaw: true
        };

    } catch (error) {
        context.log.error('Export error:', error);
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                error: 'Export failed',
                message: error.message
            }
        };
    }
};

// CSV Export
async function exportToCSV(data, options = {}) {
    try {
        // Handle different data types
        let records = Array.isArray(data) ? data : 
                     data.rows ? data.rows : 
                     data.results ? data.results : 
                     [data];

        // For KQL results with columns metadata
        if (data.columns && data.rows) {
            const headers = data.columns.map(col => col.name);
            records = data.rows.map(row => {
                const obj = {};
                headers.forEach((header, index) => {
                    obj[header] = row[index];
                });
                return obj;
            });
        }

        // For M365 incidents
        if (records[0]?.incidentNumber) {
            records = records.map(incident => ({
                'Incident Number': incident.incidentNumber,
                'Title': incident.title,
                'Severity': incident.severity,
                'Status': incident.status,
                'Classification': incident.classification,
                'Alerts': incident.alerts || 0,
                'Users': incident.users || 0,
                'Devices': incident.devices || 0,
                'IPs': incident.ips || 0,
                'Files': incident.files || 0,
                'Created': incident.createdTime,
                'Modified': incident.lastModifiedTime
            }));
        }

        const parser = new Parser({
            fields: options.fields || undefined,
            delimiter: options.delimiter || ',',
            header: options.includeHeaders !== false
        });
        const csv = parser.parse(records);

        return csv;
    } catch (error) {
        throw new Error(`CSV export failed: ${error.message}`);
    }
}

// Excel Export
async function exportToExcel(data, metadata = {}, options = {}) {
    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'AI-Icarus Web App';
        workbook.created = new Date();

        // Handle different data types
        if (data.columns && data.rows) {
            // KQL Results
            const worksheet = workbook.addWorksheet('Query Results');
            
            // Add headers
            const headers = data.columns.map(col => col.name);
            worksheet.addRow(headers);
            
            // Style headers
            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };

            // Add data rows
            data.rows.forEach(row => {
                worksheet.addRow(row);
            });

            // Auto-fit columns
            worksheet.columns.forEach(column => {
                column.width = Math.min(50, Math.max(10, column.width || 15));
            });

        } else if (Array.isArray(data)) {
            // Generic array data
            const worksheet = workbook.addWorksheet('Data');
            
            if (data.length > 0) {
                // Add headers from first object
                const headers = Object.keys(data[0]);
                worksheet.addRow(headers);
                
                // Style headers
                worksheet.getRow(1).font = { bold: true };
                worksheet.getRow(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE0E0E0' }
                };

                // Add data
                data.forEach(item => {
                    const row = headers.map(h => item[h]);
                    worksheet.addRow(row);
                });
            }
        }

        // Add metadata sheet if provided
        if (metadata && Object.keys(metadata).length > 0) {
            const metaSheet = workbook.addWorksheet('Metadata');
            metaSheet.addRow(['Property', 'Value']);
            Object.entries(metadata).forEach(([key, value]) => {
                metaSheet.addRow([key, value]);
            });
        }

        // Generate buffer
        const buffer = await workbook.xlsx.writeBuffer();
        return buffer;

    } catch (error) {
        throw new Error(`Excel export failed: ${error.message}`);
    }
}

// PDF Export
async function exportToPDF(data, metadata = {}, options = {}) {
    try {
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument();
            const chunks = [];

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Add title
            doc.fontSize(20).text(options.title || 'AI-Icarus Export', 50, 50);
            doc.moveDown();

            // Add metadata
            if (metadata.timestamp) {
                doc.fontSize(10).text(`Generated: ${new Date(metadata.timestamp).toLocaleString()}`, 50, 100);
            }
            if (metadata.user) {
                doc.fontSize(10).text(`User: ${metadata.user}`, 50, 115);
            }
            doc.moveDown();

            // Add data based on type
            if (Array.isArray(data)) {
                // For array data (incidents, etc.)
                doc.fontSize(12).text('Data Summary', 50, 150);
                doc.moveDown();

                data.forEach((item, index) => {
                    if (index > 0) doc.moveDown();
                    
                    // For M365 incidents
                    if (item.incidentNumber) {
                        doc.fontSize(11).font('Helvetica-Bold')
                           .text(`Incident #${item.incidentNumber}: ${item.title}`);
                        doc.fontSize(10).font('Helvetica')
                           .text(`Severity: ${item.severity} | Status: ${item.status}`);
                        if (item.description) {
                            doc.fontSize(9).text(item.description.substring(0, 200) + '...');
                        }
                        doc.text(`Alerts: ${item.alerts || 0}, Users: ${item.users || 0}, Devices: ${item.devices || 0}`);
                    } else {
                        // Generic object
                        Object.entries(item).forEach(([key, value]) => {
                            if (typeof value !== 'object') {
                                doc.fontSize(10).text(`${key}: ${value}`);
                            }
                        });
                    }

                    // Prevent page overflow
                    if (doc.y > 700) {
                        doc.addPage();
                    }
                });
            } else if (data.columns && data.rows) {
                // For KQL results
                doc.fontSize(12).text('Query Results', 50, 150);
                doc.moveDown();

                // Create simple table
                const headers = data.columns.map(col => col.name);
                doc.fontSize(10).font('Helvetica-Bold');
                doc.text(headers.join(' | '));
                doc.font('Helvetica');

                data.rows.slice(0, 50).forEach(row => { // Limit to 50 rows for PDF
                    const rowText = row.map(cell => 
                        String(cell).substring(0, 20)
                    ).join(' | ');
                    doc.fontSize(9).text(rowText);
                    
                    if (doc.y > 700) {
                        doc.addPage();
                    }
                });

                if (data.rows.length > 50) {
                    doc.moveDown();
                    doc.fontSize(10).text(`... and ${data.rows.length - 50} more rows`);
                }
            } else if (typeof data === 'string') {
                // For text data (AI analysis)
                doc.fontSize(11).text('Analysis Results', 50, 150);
                doc.moveDown();
                doc.fontSize(10).text(data, {
                    align: 'left',
                    width: 500
                });
            }

            doc.end();
        });

    } catch (error) {
        throw new Error(`PDF export failed: ${error.message}`);
    }
}

// Text Export
async function exportToText(data, metadata = {}, options = {}) {
    try {
        let text = '';

        // Add header
        text += '='.repeat(80) + '\n';
        text += `AI-ICARUS EXPORT - ${new Date().toISOString()}\n`;
        text += '='.repeat(80) + '\n\n';

        // Add metadata
        if (metadata && Object.keys(metadata).length > 0) {
            text += 'METADATA:\n';
            text += '-'.repeat(40) + '\n';
            Object.entries(metadata).forEach(([key, value]) => {
                text += `${key}: ${value}\n`;
            });
            text += '\n';
        }

        // Add data
        text += 'DATA:\n';
        text += '-'.repeat(40) + '\n';

        if (Array.isArray(data)) {
            data.forEach((item, index) => {
                text += `\nRecord ${index + 1}:\n`;
                if (typeof item === 'object') {
                    Object.entries(item).forEach(([key, value]) => {
                        text += `  ${key}: ${value}\n`;
                    });
                } else {
                    text += `  ${item}\n`;
                }
            });
        } else if (data.columns && data.rows) {
            // KQL results
            const headers = data.columns.map(col => col.name);
            text += headers.join('\t') + '\n';
            text += '-'.repeat(headers.join('\t').length) + '\n';
            
            data.rows.forEach(row => {
                text += row.join('\t') + '\n';
            });
        } else if (typeof data === 'string') {
            text += data;
        } else if (typeof data === 'object') {
            text += JSON.stringify(data, null, 2);
        }

        return text;

    } catch (error) {
        throw new Error(`Text export failed: ${error.message}`);
    }
}