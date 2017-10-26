const numeral = require('numeral');
const moment = require('moment');

class CSVExport {
  constructor(configuration, sales) {
    this.sales = sales;
    this.configuration = configuration;

    this.separator = configuration.configuration.csv_separator || ',';
    this.delimiter = configuration.configuration.decimal_separator || '.';
  }

  escape(value) {
    return value.replace(new RegExp(this.separator, 'g'), "\\" + this.separator);
  }

  formatNumber(value) {
    return value.replace(/\./g, this.delimiter);
  }

  outputHeaders(columns) {
    var headers = [];
    for (let index in columns) {
      let column = columns[index];
      headers.push(escape(column.header));
    }
    return headers.join(this.separator);
  }

  resolve(object, keypath) {
    return keypath.split('.').reduce((o,i)=> { if (o) { return o[i]; } else { return "undefined"; } }, object)
  }

  parametrizeString(string, object) {
      let replaced = string.replace(/({.*?})/g, j => {
          var removedBraces = j.substr(1).slice(0, -1);
          let components = removedBraces.split('|');
          var path = components[0];
          var value = this.resolve(object, path);
          if (typeof value === 'undefined') {
            if (components.length > 1) {
              return components[1];
            }
            return "XXX_ERROR_XXX";
          }
          if (value.constructor === Number) {
            return numeral(value).format('0.00');
          } else {
            return value;
          }
      });
      if (replaced.includes('XXX_ERROR_XXX')) {
        return;
      }
      return replaced;
  }

  evaluate(expression, object) {
    return this.parametrizeString(expression, object);
  }

  outputRows(row, columns, sale) {
    var aggregates = [];
    var count = 0;
    if (row.type.id == "payments_by_type_and_currency") {
      var currencies = new Set([sale.base_currency_code || 'DKK']);
      for (let index in sale.payments) {
        let type = row.type.type;
        let payment = sale.payments[index];
        if (payment.payment_type === 'cash.rounding') {
          payment.payment_type = "rounding";
        }
        if (!payment.success) { continue; }
        if (payment.payment_type.split(".")[0] !== type) { continue; }
        if (payment.foreign_currency) {
          currencies.add(payment.foreign_currency)
        }
        count++;
      }
      var rows = [];
      currencies.forEach(currency => {
        let output = this.outputRow(row, columns, sale, currency);
        if (output !== null) {
          rows.push(output);
        }
      });
      return rows;
    } else {
      let output = this.outputRow(row, columns, sale);
      // console.log(output);
      if (output !== null) {
        return [output];
      } else {
        return [];
      }
    }
  }

  outputRow(row, columns, sale, filter) {
    var aggregates = [];
    var overrides = [];
    var count = 0;
    if (row.type.id == "payments_by_type_and_currency") {
      for (let index in sale.payments) {
        let type = row.type.type;
        var payment = sale.payments[index];
        if (payment.foreign_currency) {
          payment.base_currency_amount = 0;
        } else {
          payment.base_currency_amount = payment.amount;
        }
        if (!payment.success) { continue; }
        if (payment.payment_type.split(".")[0] !== type) { continue; }
        let currency = payment.foreign_currency || sale.base_currency_code || 'DKK';
        if (currency !== filter) {
          continue;
        }
        overrides['currency'] = currency;
        for (let aggregate in row.aggregates) {
          let expression = row.aggregates[aggregate];
          let value = this.evaluate(expression, payment);
          if (typeof value === 'undefined') { continue; }
          aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value);
        }
        count++;
      }
    } else if (row.type.id == "payments_by_type") {
      for (let index in sale.payments) {
        let type = row.type.type;
        let payment = sale.payments[index];
        if (!payment.success) { continue; }
        if (payment.payment_type.split(".")[0] !== type) { continue; }
        for (let aggregate in row.aggregates) {
          let expression = row.aggregates[aggregate];
          let value = this.evaluate(expression, payment);
          if (typeof value === 'undefined') { continue; }
          aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value);
        }
        count++;
      }
    } else if (row.type.id == "line_items") {
      for (let index in sale.summary.line_items) {
        let lineItem = sale.summary.line_items[index];
        for (let aggregate in row.aggregates) {
          let expression = row.aggregates[aggregate];
          let value = this.evaluate(expression, lineItem);
          if (typeof value === 'undefined') { continue; }
          aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value);
        }
        count++;
      }
    } else if (row.type.id == "line_items_by_tax") {
      let rate = row.type.rate;
      for (let index in sale.summary.line_items) {
        let lineItem = sale.summary.line_items[index];
        if (lineItem.taxes.length != 1 || lineItem.taxes[0].rate != rate) { continue; }
        for (let aggregate in row.aggregates) {
          let expression = row.aggregates[aggregate];
          let value = this.evaluate(expression, lineItem);
          if (typeof value === 'undefined') { continue; }
          aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value);
        }
        count++;
      }
    } else if (row.type.id == "total") {
      for (let aggregate in row.aggregates) {
        let expression = row.aggregates[aggregate];
        let value = this.evaluate(expression, sale.summary);
        if (typeof value === 'undefined') { continue; }
        aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value);
      }
      count++;
    }
    if (count === 0) { return null; }
    var values = [];
    for (let key in row.values) {
      values[key] = row.values[key];
    }
    for (let key in aggregates) {
      values[key] = this.formatNumber(aggregates[key].format('0.00'));
    }
    for (let key in overrides) {
      values[key] = overrides[key];
    }

    if (row.required_values) {
      var requirementsMet = true;
      for (let index in row.required_values) {
        let required = row.required_values[index];
        if (typeof values[required] === 'undefined') {
          requirementsMet = false;
        }
      }
      if (!requirementsMet) {
        return null;
      }
    }

    var rowOutput = [];
    for (let index in columns) {
      let column = columns[index];
      if (column.value) {
        let val = (typeof values[column.value] !== 'undefined') ? values[column.value] : "";
        rowOutput.push(val);
      } else if (column.date) {
        let format = column.format || "YYYY";
        rowOutput.push(moment(this.resolve(sale, column.date)).format(format));
      } else if (column.string) {
        rowOutput.push(this.resolve(sale, column.string));
      } else {
        rowOutput.push("");
      }
    }
    return rowOutput.join(this.separator);
  }

  export() {
    var output = [];
    let headers = this.outputHeaders(this.configuration.columns);
    output.push(headers);
    for (let saleIndex in this.sales) {
      let sale = this.sales[saleIndex];
      for (let index in this.configuration.rows) {
        let row = this.configuration.rows[index];
        let rows = this.outputRows(row, this.configuration.columns, sale);
        output = output.concat(rows);
      }
    }
    return output.join("\n");
  }
}

module.exports = CSVExport;
