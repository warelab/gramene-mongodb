exports.fastbit = {
  columns: {
    description: "describe the columns in a table",
    properties : {
      featureSet: {
        type: "string",
        description: "mongo _id of featureSet",
        required: true
      }
    }
  },
  sql : {
    description : "simple sql interface",
    properties : {
      featureSet: {
        type: "string",
        description: "mongo _id of featureSet",
        required: true
      },
      select: {
        type: "string",
        description: "select clause",
        required: true
      },
      where: {
        type: "string",
        description: "where clause"
      },
      orderby: {
        type: "string",
        description: "column to sort by"
      }
    }
  },
  histogram : {
    description: "conditional 1D, 2D, or 3D histograms with adaptive or regularly spaced bins",
    properties: {
      featureSet: {
        type: "string",
        description: "mongo _id of featureSet",
        required: true
      },
      where: {
        type: "string",
        description: "query string"
      },
      adaptive: {
        type: "boolean",
        description: "use adaptive binning"
      },
      column1: {
        type: 'string',
        description: 'column1',
        required: true
      },
      nbins1: {
        type: 'integer',
        description: 'number of bins for column1'
      },
      begin1: {
        type: 'number',
        description: 'min value for column1'
      },
      end1: {
        type: 'number',
        description: 'max value for column1'
      },
      stride1: {
        type: 'number',
        description: 'bin size for column1'
      },
      column2: {
        type: 'string',
        description: 'column2'
      },
      nbins2: {
        type: 'integer',
        description: 'number of bins for column2'
      },
      begin2: {
        type: 'number',
        description: 'min value for column2'
      },
      end2: {
        type: 'number',
        description: 'max value for column2'
      },
      stride2: {
        type: 'number',
        description: 'bin size for column2'
      },
      column3: {
        type: 'string',
        description: 'column3'
      },
      nbins3: {
        type: 'integer',
        description: 'number of bins for column3'
      },
      begin3: {
        type: 'number',
        description: 'min value for column3'
      },
      end3: {
        type: 'number',
        description: 'max value for column3'
      },
      stride3: {
        type: 'number',
        description: 'bin size for column3'
      }
    }
  }
};
exports.mongo = {
  describe: {
    description: "describe a collection"
  },
  select : {
    description : "search interface",
    properties : {
      q: {
        type: "string",
        description: "query string"
      },
      l: {
        type: "string",
        pattern: '^[^:]+:[^:]+:[0-9]+:[0-9]+$',
        description: "query location"
      },
      rows: {
        type: "integer",
        description: "number of rows to return"
      },
      start: {
        type: "integer",
        description: "return documents starting at row"
      },
      fl: {
        type: "string",
        description: "list of fields to return"
      }
    }
  },
  facet : {
    description: "field facet counting",
    properties: {
      q: {
        type: "string",
        description: "query string"
      },
      field: {
        type: "string",
        description: "field to count values",
        required: "true"
      }
    }
  }
};