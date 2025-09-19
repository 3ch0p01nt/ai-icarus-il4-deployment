module.exports = async function (context, req) {
    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '1.0.0'
        }
    };
};