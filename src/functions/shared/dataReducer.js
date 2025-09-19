/**
 * Data Reduction Utilities
 * Reduces the size of query results while preserving essential information
 */

/**
 * Reduce KQL query results to essential columns
 * @param {Object} queryResults - Raw query results from KQL
 * @param {Array<string>} priorityColumns - Columns to prioritize (optional)
 * @returns {Object} Reduced query results
 */
function reduceKQLData(queryResults, priorityColumns = null) {
    // Default essential columns for common log types
    const defaultEssentials = [
        'TimeGenerated', 'timestamp', 'TenantId',
        'QueryText', 'ResponseCode', 'ResponseDurationMs',
        'AADEmail', 'WorkspaceRegion', 'Type',
        'Message', 'Level', 'Category',
        'OperationName', 'ResultType', 'ResultDescription'
    ];
    
    const essentialColumns = priorityColumns || defaultEssentials;
    
    // If no tables, return as-is
    if (!queryResults || !queryResults.tables) {
        return queryResults;
    }
    
    const reducedTables = queryResults.tables.map(table => {
        // Find indices of essential columns
        const columnIndices = [];
        const reducedColumns = [];
        
        table.columns.forEach((col, idx) => {
            if (essentialColumns.includes(col.name) || 
                (col.hasData && col.nonNullCount > 0)) {
                columnIndices.push(idx);
                reducedColumns.push(col);
            }
        });
        
        // If we removed too many columns, keep at least 10 most populated
        if (reducedColumns.length < 10) {
            const populatedColumns = table.columns
                .map((col, idx) => ({ col, idx, count: col.nonNullCount || 0 }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);
            
            populatedColumns.forEach(({ col, idx }) => {
                if (!columnIndices.includes(idx)) {
                    columnIndices.push(idx);
                    reducedColumns.push(col);
                }
            });
        }
        
        // Extract only selected column values from rows
        const reducedRows = table.rows.map(row => 
            columnIndices.map(idx => row[idx])
        );
        
        return {
            name: table.name,
            columns: reducedColumns,
            rows: reducedRows
        };
    });
    
    return {
        ...queryResults,
        tables: reducedTables,
        metadata: {
            ...queryResults.metadata,
            reduced: true,
            originalColumnCount: queryResults.tables[0]?.columns.length,
            reducedColumnCount: reducedTables[0]?.columns.length
        }
    };
}

/**
 * Smart sampling of large datasets
 * @param {Object} data - Data to sample
 * @param {number} maxRows - Maximum number of rows to keep
 * @returns {Object} Sampled data
 */
function smartSample(data, maxRows = 100) {
    if (!data || !data.tables) return data;
    
    const sampledTables = data.tables.map(table => {
        const totalRows = table.rows.length;
        
        if (totalRows <= maxRows) {
            return table; // Small enough, keep all
        }
        
        const samples = [];
        const sampleIndices = new Set();
        
        // Always include first and last
        samples.push(table.rows[0]);
        sampleIndices.add(0);
        
        if (totalRows > 1) {
            samples.push(table.rows[totalRows - 1]);
            sampleIndices.add(totalRows - 1);
        }
        
        // Include some from beginning, middle, and end
        const segments = 3;
        const segmentSize = Math.floor(totalRows / segments);
        const samplesPerSegment = Math.floor((maxRows - 2) / segments);
        
        for (let seg = 0; seg < segments; seg++) {
            const segmentStart = seg * segmentSize;
            const segmentEnd = Math.min(segmentStart + segmentSize, totalRows);
            
            for (let i = 0; i < samplesPerSegment; i++) {
                const idx = segmentStart + Math.floor(Math.random() * (segmentEnd - segmentStart));
                if (!sampleIndices.has(idx)) {
                    samples.push(table.rows[idx]);
                    sampleIndices.add(idx);
                }
            }
        }
        
        // Sort samples by original index to maintain order
        const sortedSamples = Array.from(sampleIndices)
            .sort((a, b) => a - b)
            .map(idx => table.rows[idx]);
        
        return {
            ...table,
            rows: sortedSamples,
            metadata: {
                sampled: true,
                originalRowCount: totalRows,
                sampleRowCount: sortedSamples.length,
                samplingMethod: 'stratified'
            }
        };
    });
    
    return {
        ...data,
        tables: sampledTables
    };
}

/**
 * Estimate token count for data
 * @param {any} data - Data to estimate tokens for
 * @returns {number} Estimated token count
 */
function estimateTokenCount(data) {
    const jsonString = typeof data === 'string' ? data : JSON.stringify(data);
    // Rough estimate: 4 characters per token on average
    return Math.ceil(jsonString.length / 4);
}

/**
 * Prepare data for AI analysis with size optimization
 * @param {any} data - Raw data to prepare
 * @param {number} maxTokens - Maximum tokens to allow
 * @returns {Object} Prepared data with metadata
 */
function prepareDataForAnalysis(data, maxTokens = 50000) {
    let processedData = data;
    const steps = [];
    
    // Step 1: Estimate initial size
    const initialTokens = estimateTokenCount(data);
    steps.push({ step: 'initial', tokens: initialTokens });
    
    // Step 2: Reduce columns if it's KQL data
    if (data && data.tables && initialTokens > maxTokens) {
        processedData = reduceKQLData(processedData);
        const reducedTokens = estimateTokenCount(processedData);
        steps.push({ step: 'column_reduction', tokens: reducedTokens });
    }
    
    // Step 3: Sample rows if still too large
    const currentTokens = estimateTokenCount(processedData);
    if (currentTokens > maxTokens && processedData.tables) {
        // Calculate how many rows we can afford
        const reductionRatio = maxTokens / currentTokens;
        const currentRows = processedData.tables[0]?.rows.length || 0;
        const targetRows = Math.max(10, Math.floor(currentRows * reductionRatio));
        
        processedData = smartSample(processedData, targetRows);
        const sampledTokens = estimateTokenCount(processedData);
        steps.push({ step: 'row_sampling', tokens: sampledTokens });
    }
    
    // Step 4: Final check - if still too large, return summary only
    const finalTokens = estimateTokenCount(processedData);
    if (finalTokens > maxTokens * 1.5) {
        processedData = {
            summary: {
                type: 'data_too_large',
                originalTokens: initialTokens,
                tables: data.tables?.length,
                rows: data.tables?.[0]?.rows.length,
                columns: data.tables?.[0]?.columns.length,
                message: 'Data exceeds token limits. Showing summary only.'
            },
            sample: processedData.tables?.[0]?.rows.slice(0, 3)
        };
        steps.push({ step: 'summary_only', tokens: estimateTokenCount(processedData) });
    }
    
    return {
        data: processedData,
        metadata: {
            originalTokens: initialTokens,
            finalTokens: estimateTokenCount(processedData),
            reductionSteps: steps,
            reduced: initialTokens !== estimateTokenCount(processedData)
        }
    };
}

module.exports = {
    reduceKQLData,
    smartSample,
    estimateTokenCount,
    prepareDataForAnalysis
};