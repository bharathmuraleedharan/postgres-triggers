'use strict'

const pg = require('pg')
const test = require('tape')
const triggers = require('../index.js')

const DB = `postgres://postgres:postgres@localhost:5432/triggertest`;

test('buildTriggers()', function (t) {
  t.plan(12)

  const tables = ['table1', 'table2']
  const str = triggers.buildTriggers(tables)

  tables.forEach(function (table) {
    t.ok(str.indexOf(`DROP TRIGGER IF EXISTS ${table}_notify_update ON ${table};`) > -1, 'should drop update trigger')
    t.ok(str.indexOf(`DROP TRIGGER IF EXISTS ${table}_notify_insert ON ${table};`) > -1, 'should drop insert trigger')
    t.ok(str.indexOf(`DROP TRIGGER IF EXISTS ${table}_notify_delete ON ${table};`) > -1, 'should drop delete trigger')
    t.ok(str.indexOf(`${table}_notify_update AFTER UPDATE ON`) > -1, 'should create update trigger')
    t.ok(str.indexOf(`${table}_notify_insert AFTER INSERT ON`) > -1, 'should create insert trigger')
    t.ok(str.indexOf(`${table}_notify_delete AFTER DELETE ON`) > -1, 'should create delete trigger')
  })
})

test('buildQuery(triggers)', function (t) {
  t.plan(4)

  const str = triggers.buildQuery(triggers.buildTriggers(['table']))

  t.equal(typeof str, 'string')
  t.throws(triggers.buildQuery)
  t.ok(str.indexOf(`DROP TRIGGER IF EXISTS table_notify_update ON table;`) > -1, 'should have triggers')
  t.ok(str.indexOf(`pg_notify('table_update',`) > -1, 'should have default channel')
})

test('buildQuery(triggers, opts) with channel', function (t) {
  t.plan(3)

  const str = triggers.buildQuery(triggers.buildTriggers(['table']), { channel: 'foo_chan' })

  t.equal(typeof str, 'string')
  t.ok(str.indexOf(`DROP TRIGGER IF EXISTS table_notify_update ON table;`) > -1, 'should have triggers')
  t.ok(str.indexOf(`pg_notify('foo_chan',`) > -1, 'should have correct channel')
})

function create(client, cb) {
  client.query(`
    CREATE TABLE IF NOT EXISTS triggers_test_table1 (id bigserial primary key, name varchar(20));
    CREATE TABLE IF NOT EXISTS triggers_test_table2 (id bigserial primary key, name varchar(20));
    CREATE TABLE IF NOT EXISTS triggers_test_table3 (u_id varchar(8) primary key, name varchar(20));
  `, cb)
}

function clean(client, cb) {
  client.query(`
    DROP TABLE IF EXISTS triggers_test_table1;
    DROP TABLE IF EXISTS triggers_test_table2;
    DROP TABLE IF EXISTS triggers_test_table3;
  `, cb)
}

test('create triggers', function (t) {
  const opts = {
    db: DB, tables: ['triggers_test_table1', 'triggers_test_table2']
  }

  pg.connect(opts.db, function (err, client, done) {
    if (err) throw err

    create(client, function (err2) {
      if (err2) throw err2

      triggers(opts, function (err3) {
        if (err3) throw err3

        clean(client, function (err4) {
          done(err4)
          t.ok(true, 'should create triggers')
          t.end()
        })
      })
    })
  })
})


test('test triggers', function (t) {
  t.plan(15)
  const opts = {
    db: DB, tables: [
      'triggers_test_table1', 'triggers_test_table2:id', { name: 'triggers_test_table3', id: 'u_id' }
    ]
  }

  pg.connect(opts.db, function (err, client) {
    if (err) throw err
    var cnt = 0
    client.on('notification', function (msg) {
      var pl = JSON.parse(msg.payload)
      t.ok(pl.table, 'should have table field')
      t.ok(pl.id, 'should have id field')
      t.ok(pl.type, 'should have type field')
      t.strictEqual(pl.type, 'insert', 'should lowercased type')
      t.strictEqual(typeof pl.row, 'object', 'should have row object')

      if (++cnt === 3) {
        client.end()
      }
    })

    create(client, function (err2) {
      if (err2) throw err2
      client.query('LISTEN table_update;', function (err3) {
        if (err3) throw err3
        triggers(opts, function (err4) {
          if (err4) throw err4
          client.query('INSERT INTO triggers_test_table1 (name) VALUES (\'foo\')')
          client.query('INSERT INTO triggers_test_table2 (name) VALUES (\'bar\')')
          client.query('INSERT INTO triggers_test_table3 (u_id, name) VALUES (\'uniqueid\', \'baz\')')
        })
      })
    })
  })
})
