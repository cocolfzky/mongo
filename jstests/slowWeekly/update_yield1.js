
load( "jstests/libs/slow_weekly_util.js" );
var testServer = new SlowWeeklyMongod( "update_yield1" );
var db = testServer.getDB( "test" );
testServer.getDB("admin").runCommand( {setParameter:1, ttlMonitorEnabled : false} );

var t = db.update_yield1;
t.drop();

var N = 640000;
var i = 0;

while ( true ){
    var fill = function() {
        for ( ; i<N; i++ ){
            t.insert( { _id : i , n : 1 } );
        }
    };

    var timeUpdate = function() {
        return Date.timeFunc(
            function(){
                t.update( {} , { $inc : { n : 1 } } , false , true );
                var r = db.getLastErrorObj();
            }
        );
    };

    fill();
    timeUpdate();
    timeUpdate();
    var time = timeUpdate();
    print( N + "\t" + time );
    if ( time > 8000 )
        break;

    N *= 2;
}

function haveInProgressUpdate() {
    var ops = db.currentOp();
    printjson(ops);
    return ops.inprog.some(
        function(elt) {
            return elt.op == "update";
        });
}

// --- test 1

var join = startParallelShell( "db.update_yield1.update( {} , { $inc : { n : 1 } } , false , true ); db.getLastError()" );
assert.soon(haveInProgressUpdate, "never doing update");

var num = 0;
var start = new Date();
while ( ( (new Date()).getTime() - start ) < ( time * 2 ) ){
    var me = Date.timeFunc( function(){ t.findOne(); } );
    if (me > 50) print("time: " + me);

    if ( num++ == 0 ){
        var x = db.currentOp();
        assert.eq( 1 , x.inprog.length , "nothing in prog" );
    }

    assert.gt( time / 3 , me );
}

join();

x = db.currentOp();
assert.eq( 0 , x.inprog.length , "weird 2" );

// --- test 2

join = startParallelShell( "db.update_yield1.update( { $atomic : true } , { $inc : { n : 1 } } , false , true ); db.getLastError()" );
assert.soon(haveInProgressUpdate, "never doing update 2");

while ( 1 ) {
    t.findOne();

    x = db.currentOp();
    if ( x.inprog.length == 0 )
        break;

    assert.eq( x.inprog.length, 1 );
    assert( (x.inprog[0].op == "update") ||
            // If we see the getlasterror running, that is ok.
            (x.inprog[0].op == "query" && 
             x.inprog[0].query == { "getlasterror" : 1 }), tojson( x ) );

    assert( x.inprog[0].numYields == 0 , tojson( x ) );

    sleep( 100 );
}

join();

testServer.stop();
