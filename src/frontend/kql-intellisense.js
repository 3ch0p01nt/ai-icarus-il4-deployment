// KQL IntelliSense Helper
class KQLIntelliSense {
    constructor() {
        this.schema = null;
        this.keywords = [
            // KQL Keywords
            'where', 'project', 'extend', 'summarize', 'join', 'union', 'take', 'top', 'limit',
            'sort', 'order', 'by', 'asc', 'desc', 'count', 'sum', 'avg', 'min', 'max',
            'distinct', 'mv-expand', 'parse', 'make-series', 'render', 'with', 'as',
            'on', 'in', 'contains', 'startswith', 'endswith', 'matches', 'regex',
            'and', 'or', 'not', 'between', 'ago', 'now', 'datetime', 'timespan',
            'bin', 'floor', 'ceiling', 'round', 'abs', 'sqrt', 'log', 'exp',
            'strcat', 'strlen', 'substring', 'toupper', 'tolower', 'trim',
            'split', 'extract', 'replace', 'format_datetime', 'format_timespan',
            'iff', 'iif', 'case', 'isempty', 'isnotempty', 'isnull', 'isnotnull'
        ];
        
        this.operators = [
            '==', '!=', '<', '>', '<=', '>=', '=~', '!~', 'in~', '!in~',
            '+', '-', '*', '/', '%', '..', '!', '~'
        ];
        
        this.functions = [
            'count()', 'dcount()', 'sum()', 'avg()', 'min()', 'max()', 'stdev()', 'variance()',
            'percentile()', 'percentiles()', 'make_list()', 'make_set()', 'make_bag()',
            'arg_max()', 'arg_min()', 'any()', 'anyif()', 'countif()', 'sumif()',
            'dcountif()', 'array_length()', 'bag_keys()', 'bag_merge()', 'bag_remove_keys()',
            'parse_json()', 'parse_csv()', 'parse_xml()', 'parse_url()', 'parse_path()',
            'base64_encode_tostring()', 'base64_decode_tostring()', 'hash()', 'hash_sha256()'
        ];
        
        this.timeRanges = [
            'ago(1h)', 'ago(1d)', 'ago(7d)', 'ago(30d)', 'ago(90d)',
            'between(ago(7d)..now())', 'between(ago(30d)..now())',
            'startofday(now())', 'endofday(now())', 'startofweek(now())',
            'startofmonth(now())', 'startofyear(now())'
        ];
    }

    async loadSchema(workspaceId, apiUrl, token) {
        try {
            const response = await fetch(`${apiUrl}/workspaces/${workspaceId}/schema`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                this.schema = await response.json();
                return true;
            }
        } catch (error) {
            console.error('Failed to load schema:', error);
        }
        return false;
    }

    getSuggestions(text, cursorPosition) {
        const suggestions = [];
        const lines = text.split('\n');
        const currentLine = lines[lines.length - 1];
        const words = currentLine.split(/\s+/);
        const currentWord = words[words.length - 1] || '';
        const previousWord = words[words.length - 2] || '';
        
        // Context-aware suggestions
        if (currentLine.trim() === '' || currentWord === '|') {
            // Start of query or after pipe - suggest tables
            if (this.schema && this.schema.tables) {
                this.schema.tables.forEach(table => {
                    suggestions.push({
                        type: 'table',
                        value: table.name,
                        label: table.name,
                        description: table.description,
                        insertText: table.name
                    });
                });
            }
            
            // Also suggest common operators after pipe
            if (currentWord === '|') {
                ['where', 'project', 'extend', 'summarize', 'take', 'sort', 'join', 'union'].forEach(op => {
                    suggestions.push({
                        type: 'operator',
                        value: op,
                        label: op,
                        description: `KQL ${op} operator`,
                        insertText: ` ${op} `
                    });
                });
            }
        } else if (previousWord === '|' || this.keywords.includes(previousWord.toLowerCase())) {
            // After operator - suggest relevant items
            if (previousWord === 'where' || previousWord === 'extend' || previousWord === 'project') {
                // Suggest columns for the current table
                const tableName = this.extractCurrentTable(text);
                if (tableName && this.schema) {
                    const table = this.schema.tables.find(t => t.name === tableName);
                    if (table && table.columns) {
                        table.columns.forEach(col => {
                            suggestions.push({
                                type: 'column',
                                value: col.name,
                                label: col.name,
                                description: `${col.type}${col.description ? ' - ' + col.description : ''}`,
                                insertText: col.name
                            });
                        });
                    }
                }
            } else if (previousWord === 'by' || previousWord === 'on') {
                // Suggest columns for grouping/joining
                const tableName = this.extractCurrentTable(text);
                if (tableName && this.schema) {
                    const table = this.schema.tables.find(t => t.name === tableName);
                    if (table && table.columns) {
                        table.columns.forEach(col => {
                            suggestions.push({
                                type: 'column',
                                value: col.name,
                                label: col.name,
                                description: col.type,
                                insertText: col.name
                            });
                        });
                    }
                }
            } else if (previousWord === 'summarize') {
                // Suggest aggregation functions
                this.functions.filter(f => f.includes('()')).forEach(func => {
                    suggestions.push({
                        type: 'function',
                        value: func,
                        label: func,
                        description: 'Aggregation function',
                        insertText: func.replace('()', '($0)')
                    });
                });
            }
        } else if (currentWord.startsWith('')) {
            // General autocomplete based on current word
            const lowerWord = currentWord.toLowerCase();
            
            // Filter keywords
            this.keywords.filter(k => k.startsWith(lowerWord)).forEach(keyword => {
                suggestions.push({
                    type: 'keyword',
                    value: keyword,
                    label: keyword,
                    description: 'KQL keyword',
                    insertText: keyword
                });
            });
            
            // Filter functions
            this.functions.filter(f => f.toLowerCase().startsWith(lowerWord)).forEach(func => {
                suggestions.push({
                    type: 'function',
                    value: func,
                    label: func,
                    description: 'KQL function',
                    insertText: func.includes('()') ? func.replace('()', '($0)') : func
                });
            });
            
            // Filter tables
            if (this.schema && this.schema.tables) {
                this.schema.tables
                    .filter(t => t.name.toLowerCase().startsWith(lowerWord))
                    .forEach(table => {
                        suggestions.push({
                            type: 'table',
                            value: table.name,
                            label: table.name,
                            description: table.description,
                            insertText: table.name
                        });
                    });
            }
        }
        
        // Time range suggestions
        if (currentWord.includes('ago') || currentWord.includes('between')) {
            this.timeRanges.forEach(range => {
                suggestions.push({
                    type: 'timerange',
                    value: range,
                    label: range,
                    description: 'Time range',
                    insertText: range
                });
            });
        }
        
        return suggestions;
    }

    extractCurrentTable(query) {
        // Extract the table name from the query
        const lines = query.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('|')) {
                // This is likely the table name
                const words = trimmed.split(/\s+/);
                if (words[0] && this.schema) {
                    const table = this.schema.tables.find(t => t.name === words[0]);
                    if (table) {
                        return table.name;
                    }
                }
            }
        }
        return null;
    }

    getQueryTemplates() {
        return [
            {
                name: 'Basic Query',
                template: 'TableName\n| where TimeGenerated >= ago(1d)\n| take 100',
                description: 'Simple query with time filter'
            },
            {
                name: 'Count by Category',
                template: 'TableName\n| where TimeGenerated >= ago(7d)\n| summarize Count = count() by Category\n| order by Count desc',
                description: 'Count records grouped by category'
            },
            {
                name: 'Time Series',
                template: 'TableName\n| where TimeGenerated >= ago(1d)\n| summarize Count = count() by bin(TimeGenerated, 1h)\n| render timechart',
                description: 'Create time series chart'
            },
            {
                name: 'Top N by Field',
                template: 'TableName\n| where TimeGenerated >= ago(1d)\n| summarize Count = count() by FieldName\n| top 10 by Count desc',
                description: 'Get top 10 items by count'
            },
            {
                name: 'Search Text',
                template: 'TableName\n| where TimeGenerated >= ago(1d)\n| where ColumnName contains "searchtext"\n| project TimeGenerated, ColumnName, OtherColumns',
                description: 'Search for specific text'
            },
            {
                name: 'Join Tables',
                template: 'Table1\n| join kind=inner (\n    Table2\n    | where TimeGenerated >= ago(1d)\n) on CommonField\n| project Column1, Column2, Column3',
                description: 'Join two tables on common field'
            },
            {
                name: 'Parse JSON',
                template: 'TableName\n| where TimeGenerated >= ago(1d)\n| extend ParsedData = parse_json(JsonColumn)\n| extend Field1 = ParsedData.field1, Field2 = ParsedData.field2\n| project TimeGenerated, Field1, Field2',
                description: 'Parse JSON column and extract fields'
            },
            {
                name: 'Security Events',
                template: 'SecurityEvent\n| where TimeGenerated >= ago(1d)\n| where EventID == 4625 // Failed logon\n| summarize FailedLogons = count() by Account, Computer\n| where FailedLogons > 5',
                description: 'Find failed logon attempts'
            },
            {
                name: 'Performance Metrics',
                template: 'Perf\n| where TimeGenerated >= ago(1h)\n| where ObjectName == "Processor" and CounterName == "% Processor Time"\n| summarize AvgCPU = avg(CounterValue) by Computer, bin(TimeGenerated, 5m)\n| where AvgCPU > 80',
                description: 'Monitor CPU usage'
            },
            {
                name: 'M365 Defender Incidents',
                template: 'SecurityIncident\n| where TimeGenerated >= ago(7d)\n| where Status == "Active"\n| project IncidentNumber, Title, Severity, Owner, CreatedTime\n| order by CreatedTime desc',
                description: 'Get active security incidents'
            }
        ];
    }
}

// Export for use in the main application
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KQLIntelliSense;
}