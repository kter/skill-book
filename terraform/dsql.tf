# Aurora DSQL Cluster
resource "aws_dsql_cluster" "main" {
  deletion_protection_enabled = terraform.workspace == "prd" ? true : false

  tags = {
    Name = "${var.project_name}-dsql-${terraform.workspace}"
  }
}
