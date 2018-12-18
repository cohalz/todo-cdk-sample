#!/usr/bin/env node
import cdk = require('@aws-cdk/cdk');
import { TodosampleStack } from '../lib/todosample-stack';

const app = new cdk.App();
new TodosampleStack(app, 'TodosampleStack');
app.run();
